/**
 * Single-source version constant. Read by the public-site footer
 * (`components/VersionFooter`) and the admin shell footer (rendered in
 * `app/admin/layout.tsx`).
 *
 * Per CLAUDE.md "Version-bump rule": EVERY PR bumps this constant.
 *   patch (1.1.0 → 1.1.1) — fixes, chores, refactors, docs
 *   minor (1.1.0 → 1.2.0) — new user-visible features
 *   major (1.1.0 → 2.0.0) — breaking changes / migrations of public contracts
 * The bump lives in the same commit as the change. The post-merge release
 * tag `v<APP_VERSION>` is pushed automatically as part of the autonomy
 * post-merge sequence (separate from the rollback tag).
 */
export const APP_VERSION = '1.30.0'
