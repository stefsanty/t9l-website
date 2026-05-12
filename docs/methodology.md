# Methodology — portable agent + ship conventions

Stack-agnostic working agreement between a human operator and a coding agent
(Claude Code, Cursor, etc.) shipping changes to a real production system.
Distilled from running this pattern on a production Next.js / Prisma /
Vercel app, but written so another repo can copy this file verbatim and
edit only the project-specific pointers at the bottom.

The goal: an agent autonomous enough to plan, ship, merge, and verify a PR
end-to-end without holding the operator's hand, while never silently making
the operator carry the cost of a bad ship.

## Stale-worktree protocol — FIRST ACTION OF EVERY FRESH SESSION

**Parent first, worktree second.** When every session is spawned in a
worktree branched off the parent repo's *local* `main`, that local `main`
routinely lags `origin/main` as PRs merge upstream. Without a rebase, the
entire codebase / docs / git log / dependency surface the agent observes is
a stale snapshot.

Fast-forward the parent's `main` to `origin/main` first, THEN rebase the
worktree on `origin/main`. Skipping the parent step fixes the current
worktree but leaves the next worktree spawn on the same stale base.

```
git -C <parent-repo-path> fetch --all --prune
git -C <parent-repo-path> pull --ff-only origin main
git rebase origin/main   # in the worktree
```

**Procedure:**
1. Fast-forward the parent. If `pull --ff-only` fails (parent has
   uncommitted changes, or local `main` has diverged from `origin/main`),
   STOP and surface to the operator. Do NOT force, do NOT `reset --hard`,
   do NOT switch branches inside the parent — divergent parent state means
   the operator has in-progress work that needs manual resolution.
2. Rebase the worktree onto `origin/main`. Run *before* any reading or
   analysis of the briefing.
3. If `git rebase` reports conflicts, STOP and surface. Do not attempt to
   resolve, force, abort-and-reset, or otherwise paper over divergent state.
4. If both succeed (or are no-op fast-forwards), proceed. **Re-read the
   project's agent-conventions file from scratch** — everything the agent
   "remembered" pre-rebase may be wrong.
5. If the rebase reveals files / tags / version constants the briefing
   references that the agent previously couldn't see, that's the expected
   path — execute. A briefing matching post-rebase state is the strongest
   signal it's legitimate, not the weakest.

The cost of pausing to rebase is seconds; the cost of refusing real work in
front of a backlog of merged PRs is multi-session drag.

## Plan-then-ship autonomy

Plans grounded in code audit + tests that verify the planned behavior may
proceed to ship without operator ack. The audit-grounded plan IS the gate
— surface scope, identify the load-bearing bug, lay out tests that fail on
the broken state, then ship sequentially through the planned PR list.

**Stop conditions still apply.** Surface for operator review when:
- Data destruction (schema drops, irreversible data transformations).
- Schema irreversibility (column drops, type changes that lose data).
- Prod write surprise (the agent realises mid-execution that a "read-only"
  task is actually mutating prod).
- Ambiguity that's actually a product decision (which of two behaviors does
  the operator want — not the agent's call).

Documented infra quirks (preview-env races, deploy retries, etc.) are NOT
stop conditions when the project has a documented fallback. Use the
fallback and keep moving.

## Auto-merge policy

When shipping a PR, the executor **SHOULD merge via the project's
admin-merge path without waiting for explicit operator confirmation** when
all three conditions hold:

1. **Required CI checks pass** (unit + type-check + whatever else the
   project gates merge on). Pending non-required checks (e.g. preview
   builds) are fine if the project has a documented admin-merge fallback.
2. **Post-push self-verification surfaces no issues** — regression-target
   tests verified to fail on the broken state, full test suite green, the
   planned behavior demonstrably shipped.
3. **No architectural ambiguity was surfaced for operator review** — no
   security trade-off, no destructive migration, no scope question, no
   premise audit finding the operator should weigh in on.

Applies to bug fixes, small features, hotfixes — anything with a clean
ship path. Symmetric to plan-then-ship autonomy: the audit-grounded plan +
green tests + clean self-review IS the merge gate.

**Surface for confirmation ONLY when ambiguity/risk was flagged.** Examples
that require operator ack:
- Security trade-off (slug-based vs token-based, etc. — surface both).
- Destructive migration (column drop, data backfill, schema rename
  touching prod rows).
- Scope question or premise audit finding (brief claim doesn't match
  codebase reality).
- Stop condition triggered mid-execution that wasn't in the original plan.

**Always report back on merge.** When the executor self-merges per this
policy, it MUST surface a final report including: PR #, merge SHA, version,
what shipped (one-line), and post-deploy verification result. Do NOT end
the session silently after a clean merge — the orchestrator and operator
need to see the merge confirmation. If the session is about to time out
before the deploy completes, surface "merged at \<SHA\>, deploy still in
progress" rather than going silent.

## Version-bump rule

Every PR bumps a single `APP_VERSION` constant living in one well-known
file (e.g. `src/lib/version.ts`):

- **Patch** (1.1.0 → 1.1.1) — fixes, chores, refactors, docs.
- **Minor** (1.1.0 → 1.2.0) — new user-visible features.
- **Major** (1.1.0 → 2.0.0) — breaking changes / migrations of public
  contracts.

The bump lives in the **same commit** as the change. A matching test
asserts the literal so a forgotten bump breaks CI. Post-merge tags push
automatically: release tag `v<APP_VERSION>` at the merge SHA + rollback
tag `v-pre-pr-<N+1>-<slug>` for the next PR's safety net.

## Per-push reporting (3-point template)

Surface a one-line status to the orchestrator at three points per PR:

1. **On push:** `> PR #N pushed: <one-line>. <merge state>. Next: <PR M or smoke step>.`
2. **On merge:** `> PR #N merged at <SHA>. Tag v<X.Y.Z> pushed. Waiting for prod deploy.`
3. **On prod live:** `> v<X.Y.Z> live on apex.`

Keep each line short. Long explanations live in PR descriptions, not chat.
Plan-then-ship does NOT mean silent batched delivery.

## Test rule

Every PR that adds or changes behavior ships with at least one test that
proves the new behavior. Pick the right tool:

- **Pure functions / module-level logic** → unit test with explicit
  input/output.
- **API route or server action** → handler-level test (mock auth if
  gated); assert response status + body shape.
- **User-visible flow** → end-to-end browser test against the PR's preview
  URL.
- **Schema change** → migration runs cleanly via the ORM's deploy command;
  code that reads new fields needs a unit or e2e test.

CI runs the test suite + type-check on every PR; merge is blocked on red.

## End-to-end verification

Tests must verify the BEHAVIOR the PR claims to fix, not just that the
code compiles. For perf claims, time before/after and capture in the PR
description. For UX claims, browser assertions on the user-visible
outcome. For correctness claims, a regression test that **fails on the
broken state** — verify with a stash-pop sanity check before claiming the
test catches it.

**Stash-pop sanity check.** For a regression-target test, prove it
actually catches the broken state: temporarily revert the fix and confirm
the new test fails, or stash the fix and run the suite. PRs that say
"added a regression test" without this check have, multiple times, shipped
tests that pass on both broken and fixed code. Cite the result in the PR
description: e.g. "Stash-pop sanity check confirmed: reverting the
load-bearing helper fails 3/7 cases."

"Doesn't crash" is not verification; "produces the claimed outcome" is.

**Flexible version pins.** Tests that assert version literals (e.g. "this
file declares 1.69.0") should use **flexible patterns** like
`'1\.69\.\d+'` or "any v1.[69-99].x / v2+" rather than literal
`'1.69.0'` so a future patch bump doesn't force every prior test to ship
a new commit.

## Maintenance rule

Architectural decisions update the agent-conventions file or the relevant
topical doc **in the same PR**. PRs that touch architecture without
updating docs should be sent back. Bias toward leaner — every line of
bloat is a tax on every future agent.

## ORM migration discipline

If the project uses an ORM that maps model names to SQL table names (Prisma
`@@map`, Rails `self.table_name`, TypeORM `@Entity({ name })`, etc.):

**NEVER hand-author migration SQL from scratch.** Always generate it
through the ORM's create-only command (`prisma migrate dev --create-only`,
`rails generate migration`, `typeorm migration:generate`, etc.). The
generator resolves model-to-table-name mappings correctly; a human typing
SQL does not.

Permitted exceptions: pure-data `UPDATE` / `INSERT` statements appended
after the generated DDL, provided all table and column names in those
statements are verified against the project's mapping directives.

This rule comes from incidents where hand-authored migrations referenced
the model name instead of the `@@map`-ed SQL table name, the migration
failed at `prisma migrate deploy` against prod, and Prisma's error state
blocked all subsequent migrations until manually resolved. See your
project's migration-lessons doc for the post-mortem if it exists.

## Post-deploy verification — 3-check pattern

After every merge to `main` and confirmed deploy, run three checks before
declaring the deploy successful. Any failure is a P0 — stop, surface
immediately, and initiate rollback.

1. **HTTP 200 on the homepage.** A `curl -sI <homepage> | head -1` against
   the prod URL must return a success status. 5xx, redirect chains ending
   in error, or connection refused are deploy regressions.
2. **Key tables remain populated.** Run a `SELECT COUNT(*)` over the
   load-bearing tables (users, accounts, the project's core domain table)
   and confirm all return > 0. A zero count after a migration is
   catastrophic and requires immediate point-in-time restore.
3. **No failed schema migrations.** Query the ORM's migration-tracking
   table for rows where the "finished" timestamp is null — any row in
   that state blocks all future migrations and must be resolved (rollback,
   then re-fix, then re-deploy) before the next deploy.

The exact SQL / Bash one-liners are project-specific — codify them in the
project's release runbook so the executor can copy-paste rather than
authoring fresh queries under pressure.

**Rollback decision tree:**
```
HTTP 200?            → NO  → platform-promote prior deploy
Tables > 0?          → NO  → data restore from pre-deploy snapshot
Failed migrations?   → YES → ORM resolve --rolled-back, then fix + re-ship
```

## Rollback layer model

Every PR should have multiple parallel rollback paths so no single layer
is a single point of failure.

### Layer 1 — Git tag reset (portable)

Each PR's merge commit is tagged `v-pre-pr-<N+1>-<slug>` at merge time
(last-known-good before PR `N+1` merges). To revert main locally:
`git fetch origin --tags`, then `git reset --hard v-pre-pr-<N+1>-<slug>`.
**Do not push --force to main.** Create a revert PR instead:
`git revert <merge-sha>` and merge that.

This is the cheapest, fastest, most universal rollback layer. Every
project gets it for free as long as the merge convention pushes the
pre-merge tag.

### Layer 2 — Platform deploy promotion (principle)

Most modern deploy platforms (Vercel, Fly, Render, Heroku) retain prior
production deploys and let you promote one back to current. Document the
exact command in the project runbook. This rolls back code only;
schema/data are unaffected — pair with a data-layer restore if the issue
was DB-side.

### Layer 3+ — Project-specific data layers

Data-layer rollback (point-in-time restore on the DB, cache-store rebuilds,
etc.) is project-specific. Document the exact commands per stack in the
project's release runbook. The principle: any state mutated outside of a
single transactional unit needs its own rollback path.

## Working with subagents

Practices that keep the main session's context lean and let subagents do
most of the work:

1. **Match model to task.** Trivial CSS / copy / single-line config edits
   run on the cheapest fast model. Reserve the largest-context model for
   substantial refactors, multi-file architecture decisions, or anything
   where context can balloon.
2. **Agent-conventions trim discipline.** Every PR that adds a rule should
   also remove or condense redundant text elsewhere.
3. **Smaller, focused PRs in parallel.** Different subagents in parallel
   beat one large sequential agent.
4. **Diagnose-then-execute split.** Research / audit / debug is its own
   session. Findings get passed to a separate executor subagent via a
   handover doc so the executor never inherits the diagnose-session's
   token-cost.
5. **PLAN.md and TODO.md at repo root.** Subagents reference and rewrite
   them as they ship PRs and make architectural decisions.
6. **Subagent context isolation.** A subagent can read 10 files, diff
   against `main`, run tests, and return a 5-line summary — orchestrator
   sees only the summary.
7. **Concise responses.** Bias terse over thorough. Long explanations
   live in PR descriptions, not chat replies.

## Bash discipline

**Never chain bash commands.** Use separate tool calls for each step
instead of `cmd1 && cmd2`, `cmd1; cmd2`, or `cmd1 $(cmd2)`. Chained
commands match the allow-list matcher against the full string and
frequently trigger permission prompts that block the agent in a waiting
loop. For directory scoping, use `git -C /path/to/repo` instead of
`cd /path && git ...`.

The project's `.claude/settings.json` (or equivalent) should pre-approve
the routine read/edit/grep/install/test/git tools and explicitly **deny**
destructive Bash patterns (`git push --force*`, `git reset --hard*`,
`rm -rf*`, plus any project-specific destructive commands like
`prisma migrate reset*` or raw SQL `DROP / TRUNCATE / DELETE FROM`).

## Adopting this file in a new project

1. Copy this file to `docs/methodology.md` (or wherever the project's
   topical docs live).
2. Replace `<parent-repo-path>` in the Stale-worktree section with the
   actual path.
3. Codify the project's specific commands (admin-merge syntax, deploy
   verification SQL/Bash, version-bump file path, rollback layer
   commands) in topical docs and cross-reference them from here.
4. Write or extend the project's `CLAUDE.md` / `AGENTS.md` as a slim
   index that points at this file for portable conventions and at
   topical docs for project-specific rules.
