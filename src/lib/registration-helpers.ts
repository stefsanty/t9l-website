/**
 * v2.2.15 — pure state-decider for the registration ID section.
 *
 * Centralises the priority logic that drives which UI branch
 * `RegistrationFields` renders for the ID section, so the same set of
 * inputs always lands on the same UI mode and the decision is unit-
 * testable in isolation from React state.
 *
 * Priority (top wins):
 *   1. `reupload-requested` — admin asked this user to upload a fresh
 *      ID. Forces the upload UI even if existing IDs are on file. Wins
 *      over external attestation because re-upload is the more recent
 *      admin signal.
 *   2. `external` — admin marked the ID as collected outside the app.
 *      Shows a quiet confirmation panel, no upload, no consent
 *      checkbox. No "upload my own ID" link per operator decision.
 *   3. `reuse-existing` — user has existing IDs on file (idFrontUrl +
 *      idBackUrl + idUploadedAt all set). v2.2.12 consent-checkbox
 *      path.
 *   4. `upload` — default: collect a fresh upload.
 *
 * When `idRequired === false` (league opted out of ID collection) we
 * short-circuit to `none` so the whole section is hidden — operator
 * preference is unchanged from v1.93.0.
 */

export type IdSectionMode =
  | 'none'
  | 'reupload-requested'
  | 'external'
  | 'reuse-existing'
  | 'upload'

export interface IdSectionInputs {
  idRequired: boolean
  hasExistingIds: boolean
  idCollectedExternally: boolean
  idReuploadRequested: boolean
}

export function selectIdSectionMode(input: IdSectionInputs): IdSectionMode {
  if (!input.idRequired) return 'none'
  if (input.idReuploadRequested) return 'reupload-requested'
  if (input.idCollectedExternally) return 'external'
  if (input.hasExistingIds) return 'reuse-existing'
  return 'upload'
}

/**
 * v2.2.15 — pure resolver for the invite-time external-ID preset.
 *
 * When an admin creates an invite and ticks "User has ID on file
 * externally", we capture two columns on the LeagueInvite:
 * `presetIdCollectedExternally: boolean` and an optional
 * `presetIdCollectedExternallyNotes: string`. On redemption,
 * `redeemInvite` consults this resolver to decide whether to set
 * `User.idCollectedExternally = true` and what notes string to write.
 *
 * Idempotency lives at the call site, not here — the action only
 * invokes the resolver when the User row's flag is currently false.
 *
 * Fallback note: when the admin ticks the box but supplies no notes,
 * we still want SOMETHING in the audit column so admins viewing the
 * user-detail page later can tell why the flag is set. The canonical
 * fallback string `'Pre-marked at invite creation'` is the operator-
 * approved phrasing.
 */
export interface InvitePresetExternalIdInput {
  flag: boolean
  notes: string | null | undefined
}

export interface InvitePresetExternalIdResult {
  collected: boolean
  /** Non-empty trimmed string when `collected: true`; null otherwise. */
  notes: string | null
}

export const INVITE_PRESET_EXTERNAL_FALLBACK_NOTE =
  'Pre-marked at invite creation'

export function resolveInvitePresetExternalId(
  input: InvitePresetExternalIdInput,
): InvitePresetExternalIdResult {
  if (!input.flag) return { collected: false, notes: null }
  const trimmed = typeof input.notes === 'string' ? input.notes.trim() : ''
  return {
    collected: true,
    notes: trimmed || INVITE_PRESET_EXTERNAL_FALLBACK_NOTE,
  }
}
