'use client'

import RegistrationFields, {
  type RegistrationFieldsSubmit,
} from '@/components/registration/RegistrationFields'
import { completeOnboardingWithId } from '../actions'

/**
 * v1.34.0 (PR ζ) — admin-invite onboarding form.
 *
 * v1.68.0 — collapsed to single-page using shared `RegistrationFields`.
 * v1.71.1 — files now upload client-direct to Vercel Blob; the action
 * receives URLs instead of FormData (see RegistrationFields docstring
 * for the platform 4.5MB body-cap rationale).
 */

interface Props {
  code: string
  playerId: string
  initialName: string
  /**
   * v1.78.0 — pre-fill for the email field. Threaded from the page
   * server-component when the User has a verified email; empty string
   * for LINE-only users.
   */
  initialEmail: string
  initialPosition: 'GK' | 'DF' | 'MF' | 'FW' | null
  /**
   * v1.81.0 — gate for the ID upload segment. Computed by the page
   * server-component as `league.idRequired && !user.idUploadedAt`.
   */
  requireId: boolean
}

export default function OnboardingForm({
  code,
  playerId,
  initialName,
  initialEmail,
  initialPosition,
  requireId,
}: Props) {
  async function handleSubmit(input: RegistrationFieldsSubmit) {
    await completeOnboardingWithId({
      code,
      playerId,
      name: input.name,
      email: input.email,
      position: input.position === '' ? null : input.position,
      // v1.81.0 — empty strings come from the no-id path; server action
      // re-derives whether ID is required and accepts nulls accordingly.
      idFrontUrl: input.idFrontUrl || null,
      idBackUrl: input.idBackUrl || null,
      profilePictureUrl: input.profilePictureUrl,
      comments: input.comments || null,
    })
    // completeOnboardingWithId redirects on success — anything past
    // here only runs if the action returns instead of throwing/redirecting.
  }

  return (
    <div data-testid="onboarding-form">
      <RegistrationFields
        initialName={initialName}
        initialEmail={initialEmail}
        initialPosition={initialPosition}
        requireId={requireId}
        submitLabel="Save and finish"
        uploadPathPrefix={`player-id/${playerId}`}
        picturePathPrefix={`player-profile/${playerId}`}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
