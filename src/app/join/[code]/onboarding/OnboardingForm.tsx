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
  initialPosition: 'GK' | 'DF' | 'MF' | 'FW' | null
}

export default function OnboardingForm({
  code,
  playerId,
  initialName,
  initialPosition,
}: Props) {
  async function handleSubmit(input: RegistrationFieldsSubmit) {
    await completeOnboardingWithId({
      code,
      playerId,
      name: input.name,
      position: input.position === '' ? null : input.position,
      idFrontUrl: input.idFrontUrl,
      idBackUrl: input.idBackUrl,
      profilePictureUrl: input.profilePictureUrl,
    })
    // completeOnboardingWithId redirects on success — anything past
    // here only runs if the action returns instead of throwing/redirecting.
  }

  return (
    <div data-testid="onboarding-form">
      <RegistrationFields
        initialName={initialName}
        initialPosition={initialPosition}
        submitLabel="Save and finish"
        uploadPathPrefix={`player-id/${playerId}`}
        picturePathPrefix={`player-profile/${playerId}`}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
