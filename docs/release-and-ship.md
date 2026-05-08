# Release & ship

How to take a change from a worktree to live on apex.

## Sequence per PR

1. **Stale-worktree protocol** (rebase first — see CLAUDE.md).
2. **Plan + audit.** Surface scope, identify the load-bearing bug, lay out tests that fail on the broken state.
3. **Implement.** Edit code; bump `APP_VERSION`; update tests in the same commit.
4. **Local verify.** `npm run test:run` clean. Type-check clean (`tsc --noEmit`).
5. **Commit.** Conventional commit style: `vX.Y.Z: <one-line summary>`.
6. **Push.** Surface a one-line "PR #N pushed" status to the orchestrator.
7. **Open PR.** `gh pr create` with a body that explains: scope, what shipped, tests added (with regression-target details), out-of-scope items, version bump rationale.
8. **CI.** Vitest + tsc must pass. If Vercel preview races (rare post-v1.58.1 — see [known-infra-issues.md](known-infra-issues.md)), use admin-merge fallback.
9. **Merge.** Surface "PR #N merged at <SHA>. Tag v<X.Y.Z> pushed."
10. **Tag.** Annotated release tag `v<X.Y.Z>` at the merge SHA. Rollback tag `v-pre-pr-<N+1>-<slug>` for the next PR's safety net.
11. **Wait for prod deploy.** Vercel auto-deploys on `main` push. Surface "v<X.Y.Z> live on apex." once `data-version-footer` confirms.

## Version-bump rule

Every PR bumps `APP_VERSION` in [`src/lib/version.ts`](../src/lib/version.ts):
- **Patch** (1.1.0 → 1.1.1) — fixes, chores, refactors, docs.
- **Minor** (1.1.0 → 1.2.0) — new user-visible features.
- **Major** (1.1.0 → 2.0.0) — breaking changes / migrations of public contracts.

The bump lives in the same commit as the change. The matching test in [`tests/unit/version.test.ts`](../tests/unit/version.test.ts) updates in the same commit.

## Per-push reporting

Plan-then-ship does NOT mean silent batched delivery. Surface a one-line status at three points per PR:

1. **On push:** `> PR #N pushed: <one-line description>. <merge state>. Next: <PR M or smoke step>.`
2. **On merge:** `> PR #N merged at <SHA>. Tag v<X.Y.Z> pushed. Waiting for prod deploy.`
3. **On prod live:** `> v<X.Y.Z> live on apex.`

One sentence each. The full PR description, test counts, and verification details belong in the GitHub PR body.

## Plan-then-ship autonomy

Plans grounded in code audit + tests that verify the planned behavior may proceed to ship without orchestrator ack. The audit-grounded plan IS the gate. **Stop conditions still apply**: data destruction (Layer 3 / 5 / 5b / 5c), schema irreversibility (DROP COLUMN, type changes that lose data), prod write surprise, or ambiguity that's actually a product decision. Surface these immediately rather than guessing. The Neon-Vercel preview-env race is NOT a stop condition — it's documented and the fallback is `gh pr merge <num> --admin --merge` once Unit + tsc are green.

## Backups & rollback runbook

Every PR ≥ 2 has four parallel rollback paths.

### Layer 1 — Git tag reset

Each PR's merge commit is tagged `v-pre-pr-<N+1>-<slug>` (last-known-good before PR (N+1) merges).

To revert main locally: `git fetch origin --tags`, then `git reset --hard v-pre-pr-2-backfill` (two separate commands — see Bash discipline). **Do not push --force to main.** Create a revert PR instead: `git revert <merge-sha>` and merge that.

### Layer 2 — Vercel deploy promotion

Vercel retains every prior production deploy. To promote a previous prod deploy back to current: `vercel promote <deploy-url>`. This rolls back code only; schema/data are unaffected — pair with Layer 3 if the issue was DB-side.

### Layer 3 — Neon branch restore

Before each non-trivial PR merges, snapshot the prod DB:
```
neonctl branches create --name pre-pr-<N>-<slug> --parent production --project-id young-lake-57212861
```
To restore: `neonctl branches restore production --source pre-pr-<N>-<slug> --project-id young-lake-57212861`. Destructive on the current `production` branch — confirm with the operator.

Project: `young-lake-57212861`. Default Neon branch is `production` (not `main`). Org: `org-floral-feather-76166317`.

**Neon free-tier branch limit (10 concurrent).** Additive-only PRs may proceed without a snapshot, with a "Snapshot not taken" note + rollback recipe (`DROP TABLE/COLUMN ...` + code revert) in the ledger row. Non-additive PRs (column drops, type changes, data migrations) must wait for a snapshot to be retired before merging.

### Layer 5 — Redis player-mapping rebuild

If Upstash loses data — wipe, namespace cleared, region failover — every authenticated session degrades to "orphan" until rebuilt. Prisma `Player.lineId` is the durable secondary.

Recovery: pull prod env into the local shell so `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `DATABASE_URL` point at production. Then:
```
npx tsx scripts/backfillRedisFromPrisma.ts --dry-run --verbose
npx tsx scripts/backfillRedisFromPrisma.ts --apply --verbose
```
Idempotent. Per-row decisions: CREATE / MATCH / DRIFT-OVERWRITE.

### Layer 5b — Redis RSVP rebuild

Same shape for `t9l:rsvp:gw:` namespace. Recovery script: `scripts/backfillRedisRsvpFromPrisma.ts`. Per-GameWeek decisions: CREATE / MATCH / DRIFT-OVERWRITE (DELs the existing hash before write to ensure onlyInRedis fields don't survive).

**Cutover protocol:** run `--dry-run` against prod Upstash BEFORE merging any code that flips a read path to Redis-canonical. After operator review, run `--apply`. Then merge. Reverse order means the first dashboard render post-deploy hits miss for every GW and falls through to Prisma simultaneously — transient cold-Neon storm.

### Layer 5c — Write-side audit (Redis canonical, Prisma drifted)

If a `[v1.8.0 DRIFT]` log line surfaces in Vercel logs, the deferred Prisma write failed and the durable row is missing/stale. Recovery:
```
npx tsx scripts/auditRedisVsPrisma.ts                       # dry-run, both domains
npx tsx scripts/auditRedisVsPrisma.ts --domain=playerMapping --verbose
npx tsx scripts/auditRedisVsPrisma.ts --domain=rsvp --verbose
npx tsx scripts/auditRedisVsPrisma.ts --repair-prisma       # actually repair
```
Categories: MATCH / REDIS-ONLY (v1.8.0 drift — repair fixes) / PRISMA-ONLY (Layer 5/5b territory) / DIFFERING (Redis canonical wins) / MALFORMED (reported only). Idempotent.

## Per-PR snapshot ledger

A markdown table tracking the most recent ~10 PR merge commits, git tags, prod deploy URLs, and schema deltas. Append-only; older rows live in git log + tag history. The current table is in [docs/ledger-archive.md](ledger-archive.md). Future PRs add a row.

## Operational events log

One-shot ops on shared systems (Redis cleanup, manual DB writes outside a migration) get a dated line in [docs/ledger-archive.md](ledger-archive.md). Most-recent-5 retained; older entries live in git history.

## Working with subagents

Practices that keep the main session's context lean and let subagents do most of the work:

1. **Match model to task.** Trivial CSS / copy / single-line config edits run on Sonnet or Haiku. Reserve Opus for substantial refactors, multi-file architecture decisions, or anything where context can balloon.
2. **CLAUDE.md trim discipline.** Every PR that adds a rule should also remove or condense redundant text elsewhere.
3. **Smaller, focused PRs in parallel.** Different subagents in parallel beat one large sequential agent.
4. **Diagnose-then-execute split.** Research/audit/debug is its own session. Findings get passed to a separate executor subagent.
5. **PLAN.md and TODO.md at repo root.** Subagents reference and rewrite them as they ship PRs and make architectural decisions.
6. **Subagent context isolation.** A subagent can read 10 files, diff against `main`, run tests, and return a 5-line summary — orchestrator sees only the summary.
7. **Concise responses.** Bias terse over thorough. Long explanations live in PR descriptions, not chat replies.
