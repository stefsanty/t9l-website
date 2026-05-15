'use client'

import { useState } from 'react'
import RegistrationFields, {
  type RegistrationFieldsSubmit,
} from '@/components/registration/RegistrationFields'
import TeamPickerSection from '@/components/onboarding/TeamPickerSection'
import { completeOnboardingWithId } from '../actions'
import type { BallType } from '@/lib/positions'
import type { TeamPickerOption } from '@/lib/onboarding-team-options'

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
 *
 * v2.2.9 — when the league has `allowPlayerTeamPick === true`, renders a
 * `TeamPickerSection` ABOVE the `RegistrationFields`. The chosen
 * `leagueTeamId` (or `null` for "balanced team") is threaded into the
 * server action call. The form blocks submit until the user picks one of
 * the cards (including the balanced option). When the toggle is off, the
 * picker is not rendered and `chosenTeamId` stays `undefined`.
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
  /**
   * v1.93.0 — when false, the league has disabled the ID-upload
   * requirement on onboarding. Threaded down so RegistrationFields can
   * hide the ID front/back section. Server action re-checks.
   */
  idRequired?: boolean
  /** v2.2.9 — per-league team-picker toggle. */
  allowPlayerTeamPick?: boolean
  /** v2.2.9 — eligible teams + member rosters for the picker cards. */
  teamPickerOptions?: ReadonlyArray<TeamPickerOption>
  /**
   * v2.2.12 — true when this User already has ID images on file from
   * a previous league. Threaded into RegistrationFields so it can
   * render the consent-checkbox reuse path instead of the upload fields.
   * Server action re-verifies the User state before honouring reuse.
   */
  hasExistingIds?: boolean
}

// v2.2.9 — sentinel for "no selection yet" (distinct from `null`, which
// means the user explicitly chose the "balanced team" option).
const NO_SELECTION = Symbol('no-team-selection')
type TeamSelection = string | null | typeof NO_SELECTION

export default function OnboardingForm({
  code,
  playerId,
  initialName,
  initialEmail,
  initialPositions = [],
  ballType = null,
  idRequired = true,
  allowPlayerTeamPick = false,
  teamPickerOptions = [],
  hasExistingIds = false,
}: Props) {
  const [teamSelection, setTeamSelection] = useState<TeamSelection>(NO_SELECTION)
  const [teamPickerError, setTeamPickerError] = useState<string | null>(null)

  async function handleSubmit(input: RegistrationFieldsSubmit) {
    // v2.2.9 — team-picker validation gate. The server action also
    // re-checks; this is the form-level affordance.
    if (allowPlayerTeamPick && teamSelection === NO_SELECTION) {
      setTeamPickerError('Pick a team (or "balanced team") to continue.')
      // Throw so RegistrationFields surfaces a generic error AND scrolls
      // back to the top — the picker is above the submit button.
      throw new Error('Pick a team (or "balanced team") to continue.')
    }
    setTeamPickerError(null)
    const chosenTeamId = allowPlayerTeamPick
      ? (teamSelection === NO_SELECTION ? null : teamSelection)
      : undefined
    await completeOnboardingWithId({
      code,
      playerId,
      name: input.name,
      email: input.email,
      preferredPositions: input.preferredPositions,
      secondaryPositions: input.secondaryPositions,
      idFrontUrl: input.idFrontUrl,
      idBackUrl: input.idBackUrl,
      profilePictureUrl: input.profilePictureUrl,
      comments: input.comments || null,
      chosenTeamId,
      reuseExistingId: input.reuseExistingId,
    })
    // completeOnboardingWithId redirects on success — anything past
    // here only runs if the action returns instead of throwing/redirecting.
  }

  return (
    <div data-testid="onboarding-form">
      {allowPlayerTeamPick && (
        <div className="mb-5">
          <TeamPickerSection
            options={teamPickerOptions}
            value={teamSelection === NO_SELECTION ? undefined : teamSelection}
            onChange={(next) => {
              setTeamSelection(next)
              setTeamPickerError(null)
            }}
          />
          {teamPickerError && (
            <p
              className="text-vibrant-pink text-xs mt-2"
              data-testid="onboarding-team-picker-error"
            >
              {teamPickerError}
            </p>
          )}
        </div>
      )}
      <RegistrationFields
        initialName={initialName}
        initialEmail={initialEmail}
        initialPositions={initialPositions}
        ballType={ballType}
        idRequired={idRequired}
        hasExistingIds={hasExistingIds}
        submitLabel="Save and finish"
        uploadPathPrefix={`player-id/${playerId}`}
        picturePathPrefix={`player-profile/${playerId}`}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
