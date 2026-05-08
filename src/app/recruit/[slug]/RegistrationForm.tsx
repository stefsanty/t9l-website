'use client'

import { useRouter } from 'next/navigation'
import RegistrationFields, {
  type RegistrationFieldsSubmit,
} from '@/components/registration/RegistrationFields'
import { registerToLeague } from '@/app/api/recruiting/actions'
import type { BallType } from '@/lib/positions'

/**
 * v1.81.0 — origin-path for the post-submit success popup. The
 * `/recruit/<slug>` route's server-component guard redirects users with
 * a now-bound Player back to `/id/<slug>`, so popping the popup on
 * `/recruit/<slug>?submitted=...` would short-circuit before the modal
 * could mount. We hardcode the league page (`/id/<slug>`) instead — that's
 * also where the recruiting banner re-renders as State B ("being
 * reviewed") so the popup overlays the correct surface.
 */

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
   * v1.82.0 — league format. Threaded from the page server-component
   * so the position chip vocabulary matches the league's format
   * (SOCCER → 12 codes; FUTSAL → GK/FIXO/ALA/PIVOT).
   */
  ballType?: BallType | null
}

export default function RegistrationForm({
  leagueId,
  leagueSlug,
  leagueName,
  userId,
  initialEmail = '',
  ballType = null,
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
      positions: input.positions,
      idFrontUrl: input.idFrontUrl,
      idBackUrl: input.idBackUrl,
      profilePictureUrl: input.profilePictureUrl,
      comments: input.comments || null,
      // v1.81.0 — pin the post-submit popup to the league page; see
      // file-level docstring for why we don't capture window.pathname.
      originPath: `/id/${leagueSlug}`,
    })
    router.push(`/id/${leagueSlug}`)
  }

  return (
    <div data-testid="recruit-registration-form">
      <RegistrationFields
        initialEmail={initialEmail}
        ballType={ballType}
        submitLabel={`Apply to ${leagueName}`}
        uploadPathPrefix={`register-pending/${userId}`}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
