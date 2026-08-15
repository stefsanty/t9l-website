/**
 * Single source of truth for the app version shown in the footer and used
 * as the release tag suffix.
 *
 * Bumped per the CLAUDE.md "Version-bump rule" on every PR. The matching
 * pin in `tests/unit/version.test.ts` fails CI if the two drift.
 *
 * Per CLAUDE.md "Version-bump rule": EVERY PR bumps this constant.
 *   patch (1.1.0 → 1.1.1) — fixes, chores, refactors, docs
 *   minor (1.1.0 → 1.2.0) — new user-visible features
 *   major (1.1.0 → 2.0.0) — breaking changes / migrations of public contracts
 * The bump lives in the same commit as the change. The post-merge release
 * tag `v<APP_VERSION>` is pushed automatically as part of the autonomy
 * post-merge sequence (separate from the rollback tag).
 */
export const APP_VERSION = '2.4.4'
