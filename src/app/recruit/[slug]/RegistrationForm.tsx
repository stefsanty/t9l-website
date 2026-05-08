'use client'

import { useRouter } from 'next/navigation'
import RegistrationFields, {
  type RegistrationFieldsSubmit,
} from '@/components/registration/RegistrationFields'
import { registerToLeague } from '@/app/api/recruiting/actions'

/**
 * v1.68.0 — `/recruit/[slug]` form, single-page name + position + ID
 * front + ID back + (optional) profile picture.
 *
 * v1.71.1 — files now upload client-direct to Vercel Blob via the
 * shared `RegistrationFields` component (see that file's docstring for
 * the why). `registerToLeague` now takes a typed input object with the
 * resulting Blob URLs instead of a FormData multipart payload, so the
 * Vercel platform 4.5MB body cap no longer applies.
 *
 * On success: router.push(`/id/<slug>`) where the apex
 * RecruitingBanner shows State B ("Application submitted").
 */

interface Props {
  leagueId: string
  leagueSlug: string
  leagueName: string
  /** The signed-in user's id; threaded into the upload pathname prefix. */
  userId: string
  /**
   * v1.78.0 — pre-fill for the email field. Threaded from the page
   * server-component when the User has a verified email (Google OAuth
   * or email-magic-link). Empty string for LINE-only users.
   */
  initialEmail?: string
  /**
   * v1.81.0 — gate for the ID upload segment. Computed by the page
   * server-component as `league.idRequired && !user.idUploadedAt` so
   * the segment hides for leagues that opted out AND for users who
   * already submitted ID for any league.
   */
  requireId: boolean
}

export default function RegistrationForm({
  leagueId,
  leagueSlug,
  leagueName,
  userId,
  initialEmail = '',
  requireId,
}: Props) {
  const router = useRouter()

  async function handleSubmit(input: RegistrationFieldsSubmit) {
    // v1.77.1 — registerToLeague calls `redirect()` server-side on the
    // success path; the NEXT_REDIRECT signal propagates through
    // useTransition and triggers navigation even when iOS Safari has
    // backgrounded the tab mid-upload.  The router.push below is an
    // unreachable defensive fallback in case the action is ever reverted
    // to a return-shape.
    await registerToLeague({
      leagueId,
      name: input.name,
      email: input.email,
      position: input.position === '' ? null : input.position,
      // v1.81.0 — when the ID segment is hidden, RegistrationFields
      // returns empty strings; the server action treats empty strings
      // as "no upload, do not write idFrontUrl/idBackUrl/idUploadedAt".
      idFrontUrl: input.idFrontUrl || null,
      idBackUrl: input.idBackUrl || null,
      profilePictureUrl: input.profilePictureUrl,
      comments: input.comments || null,
    })
    router.push(`/id/${leagueSlug}`)
  }

  return (
    <div data-testid="recruit-registration-form">
      <RegistrationFields
        initialEmail={initialEmail}
        requireId={requireId}
        submitLabel={`Apply to ${leagueName}`}
        uploadPathPrefix={`register-pending/${userId}`}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
