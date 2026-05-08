'use client'

import RegistrationFields, {
  type RegistrationFieldsSubmit,
} from '@/components/registration/RegistrationFields'
import { completeOnboardingWithId } from '../actions'
import type { BallType } from '@/lib/positions'

/**
 * v1.34.0 (PR ζ) — admin-invite onboarding form.
 *
 * v1.68.0 — collapsed to single-page using shared `RegistrationFields`.
 * v1.71.1 — files now upload client-direct to Vercel Blob; the action
 * receives URLs instead of FormData (see RegistrationFields docstring
 * for the platform 4.5MB body-cap rationale).
 *
 * v1.82.0 — `initialPosition` (single string) replaced with
 * `initialPositions` (array) and a new `ballType` so the multi-select
 * chip picker shows the right vocabulary for soccer vs futsal.
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
  /** v1.82.0 — multi-position pre-fill. Codes already validated server-side. */
  initialPositions?: ReadonlyArray<string>
  /** v1.82.0 — league format. Drives the position chip vocabulary. */
  ballType?: BallType | null
}

export default function OnboardingForm({
  code,
  playerId,
  initialName,
  initialEmail,
  initialPositions = [],
  ballType = null,
}: Props) {
  async function handleSubmit(input: RegistrationFieldsSubmit) {
    await completeOnboardingWithId({
      code,
      playerId,
      name: input.name,
      email: input.email,
      positions: input.positions,
      idFrontUrl: input.idFrontUrl,
      idBackUrl: input.idBackUrl,
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
        initialPositions={initialPositions}
        ballType={ballType}
        submitLabel="Save and finish"
        uploadPathPrefix={`player-id/${playerId}`}
        picturePathPrefix={`player-profile/${playerId}`}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
