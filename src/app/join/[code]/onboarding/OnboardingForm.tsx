'use client'

import RegistrationFields from '@/components/registration/RegistrationFields'
import { completeOnboardingWithId } from '../actions'

/**
 * v1.34.0 (PR ζ) — admin-invite onboarding form.
 *
 * v1.68.0 — collapsed to single-page using shared `RegistrationFields`.
 * Captures name + position + ID front + ID back + optional profile
 * picture in one submit. Submit hits `completeOnboardingWithId`
 * (FormData) which atomically updates Player + PLM + flips
 * onboardingStatus to COMPLETED, then redirects to /welcome.
 *
 * Pre-v1.68.0 the flow was: this form (name + position) → /id-upload
 * (ID front + back) → /welcome. Three round-trips, three render cycles.
 * Post-v1.68.0: one form, one submit, /welcome. The /id-upload route
 * stays as a defensive fallback — see id-upload/page.tsx for the
 * pre-v1.68.0 partial-state handling.
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
  async function handleSubmit(formData: FormData) {
    formData.append('code', code)
    formData.append('playerId', playerId)
    await completeOnboardingWithId(formData)
    // completeOnboardingWithId redirects on success — anything past
    // here only runs if the action returns instead of throwing/redirecting.
  }

  return (
    <div data-testid="onboarding-form">
      <RegistrationFields
        initialName={initialName}
        initialPosition={initialPosition}
        submitLabel="Save and finish"
        onSubmit={handleSubmit}
      />
    </div>
  )
}
