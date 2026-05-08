# Testing

Two tools, both wired into `package.json` and CI.

| Stack | Purpose | Where |
|-------|---------|-------|
| **Vitest** | Pure-function and module-level tests; runs in CI on every PR | `tests/unit/**/*.test.ts(x)`; config in `vitest.config.ts` |
| **Playwright** | End-to-end against a base URL (defaults to `https://t9l.me`); run locally pre-merge for user-flow changes | `tests/e2e/**/*.spec.ts`; config in `playwright.config.ts` |

## Scripts

```bash
npm test            # vitest watch
npm run test:run    # vitest one-shot (same as CI)
npm run test:e2e    # playwright against $BASE_URL
npm run test:ci     # vitest only (e2e is opt-in in CI)
```

CI workflow `.github/workflows/test.yml` runs `npm ci`, `prisma generate` (placeholder URLs — no DB connection needed for codegen), `tsc --noEmit`, then `vitest run`. PRs are merge-blocked on red.

## What to add per change-type

- **Pure-function or library change** → Vitest unit test with explicit input/output. Example: `tests/unit/slugify.test.ts`.
- **API route or server action** → Vitest test that calls the handler directly (mock `next-auth` session if auth-gated); assert response status + body shape.
- **Public UI flow change** → Playwright e2e covering the user-visible behavior. Run against the PR's preview URL (`BASE_URL=<preview>`) before requesting merge.
- **Backfill / migration script** → Vitest unit tests for row mappers + decision helpers. Integration test that runs the full backfill against the per-PR Neon branch DB and asserts row counts + spot-check fields.
- **Schema change** → Migration correctness is covered by `prisma migrate deploy`. Code that reads new fields needs a unit or e2e test.

## End-to-end verification rule

Every PR's tests must verify the BEHAVIOR the PR claims to fix, not just that the code compiles. For perf claims, time before/after on dev preview and capture in the PR description. For UX claims, Playwright assertions on the user-visible outcome. For correctness claims, a regression test that **fails on the broken state** — e.g. for the v1.9.0 JST fix, a test that takes "14:30 JST" through parse → store → display and asserts the displayed time is "14:30", which would have failed on the v1.8.x V8/Vercel TZ=UTC bug. "Doesn't crash" is not verification; "produces the claimed outcome" is.

## Stash-pop sanity check

For a regression-target test, verify it actually catches the broken state. Either temporarily revert the fix and confirm the new test fails, or stash the fix and run the suite. PRs that say "added a regression test" without this check have, multiple times, shipped tests that pass on both broken and fixed code. Cite the result in the PR description: e.g. "Stash-pop sanity check confirmed: reverting just `admin-data.ts` fails 3/7 cases."

## Version-pin tests

[`tests/unit/version.test.ts`](../tests/unit/version.test.ts) pins `APP_VERSION` literal. Bump in the same commit as `src/lib/version.ts`. Other tests that assert version literals (e.g. `tests/unit/v1.69.0_*.test.ts` checking the file declares `1.69.0`) should use **flexible patterns** like `'1\.69\.\d+'` or "any v1.[69-99].x / v2+" rather than literal `'1.69.0'` so a future patch bump doesn't force every prior test to ship a new commit. The v1.69.1 fix established this pattern.

## CI runtime today

~2560 unit tests pass | 2 skipped at v1.79.x. Type-check clean. Vitest run completes in 5–15s on CI; the slow part is `npm ci` + `prisma generate`.
