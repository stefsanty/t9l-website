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
}

export default function RegistrationForm({
  leagueId,
  leagueSlug,
  leagueName,
  userId,
  initialEmail = '',
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
      idFrontUrl: input.idFrontUrl,
      idBackUrl: input.idBackUrl,
      profilePictureUrl: input.profilePictureUrl,
      comments: input.comments || null,
    })
    router.push(`/id/${leagueSlug}`)
  }

  return (
    <div data-testid="recruit-registration-form">
      <RegistrationFields
        initialEmail={initialEmail}
        submitLabel={`Apply to ${leagueName}`}
        uploadPathPrefix={`register-pending/${userId}`}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
