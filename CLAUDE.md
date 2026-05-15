# CLAUDE.md

T9L.me — mobile-first website for the Tennozu 9-Aside League, a recreational football league in Tokyo. Multi-tenant: a single Vercel deployment serves multiple leagues, each at `/id/<slug>`. Players sign in (LINE / Google / email magic-link), claim a Player record, RSVP availability for matchdays, and view live league data backed by Postgres (Neon) + Upstash Redis.

**Current release:** v2.2.12. Active per-PR ledger: [docs/ledger.md](docs/ledger.md). Pre-v1.78.0 condensed history: [docs/ledger-archive.md](docs/ledger-archive.md).

## How this repo's conventions are organised

- **[docs/methodology.md](docs/methodology.md)** — portable agent + ship conventions usable in ANY project: stale-worktree protocol, plan-then-ship autonomy, auto-merge policy, version-bump rule, per-push reporting, test rule, end-to-end verification + stash-pop, ORM migration discipline (Prisma / Rails / TypeORM / etc.), post-deploy 3-check pattern, rollback layer model, subagent workflow, Bash discipline. Re-read this first if you forget how shipping is supposed to work.
- **This file (CLAUDE.md)** — t9l-specific orientation: stack, project-specific rules, pointers to the topical docs below.
- **Topical docs** — one file per architectural surface, listed in the table below.

## Topical docs

Read the relevant one before working in that area.

| Topic | File |
|-------|------|
| Architecture, file structure, env vars, public id conventions | [docs/architecture.md](docs/architecture.md) |
| Prisma schema + identity model (User/Player/PLM/Account) | [docs/data-model.md](docs/data-model.md) |
| State-on-Redis pattern (playerMappingStore, rsvpStore) | [docs/redis-state.md](docs/redis-state.md) |
| NextAuth, providers, JWT callback, recruit/onboarding flows | [docs/auth.md](docs/auth.md) |
| Time handling (JST conventions) | [docs/time-handling.md](docs/time-handling.md) |
| Cache invalidation (`revalidate({ domain })` canonical) | [docs/cache-invalidation.md](docs/cache-invalidation.md) |
| Testing (Vitest, Playwright, regression-target, stash-pop) | [docs/testing.md](docs/testing.md) |
| Release & ship process (autonomy, rollback layers 1–5c, post-deploy SQL/Bash) | [docs/release-and-ship.md](docs/release-and-ship.md) |
| Admin-orthogonal-UX standing rule | [docs/admin-orthogonal-ux.md](docs/admin-orthogonal-ux.md) |
| Known infra issues (Neon-Vercel race, Vercel body cap, V8 TZ trap) | [docs/known-infra-issues.md](docs/known-infra-issues.md) |
| Domain migration runbook | [docs/domain-migration-runbook.md](docs/domain-migration-runbook.md) |
| Active ledger (most-recent PRs) | [docs/ledger.md](docs/ledger.md) |
| Ledger archive (older PRs, snapshot table, ops events) | [docs/ledger-archive.md](docs/ledger-archive.md) |
| Migration SQL rules + v1.86.0 post-mortem (@@map foot-gun) | [docs/migration-sql-lessons.md](docs/migration-sql-lessons.md) |
| Portable methodology (agent + ship conventions, stack-agnostic) | [docs/methodology.md](docs/methodology.md) |

## First action of every fresh session — stale-worktree protocol

The portable procedure lives in [docs/methodology.md § Stale-worktree protocol](docs/methodology.md#stale-worktree-protocol--first-action-of-every-fresh-session). For this repo specifically, run:

```
git -C /Users/stefan/t9l-website fetch --all --prune
git -C /Users/stefan/t9l-website pull --ff-only origin main
git rebase origin/main   # in the worktree
```

If either command fails or rebase reports conflicts, STOP and surface to the operator. Do NOT force, do NOT `reset --hard`, do NOT switch branches inside the parent.

## Project-specific standing rules

Portable rules (auto-merge policy, version-bump, per-push reporting, test rule, stash-pop, subagent model-tier matching, Bash discipline, ORM migration discipline, post-deploy 3-check pattern) all live in [docs/methodology.md](docs/methodology.md). The rules below are t9l-specific — they reference this repo's stack, identifiers, or domain concepts.

**Autonomy permissions.** The Claude Code harness reads `.claude/settings.json` (committed) and `.claude/settings.local.json` (gitignored). The committed file pre-approves routine read/edit/grep/install/test/git/gh/vercel/neonctl tools and explicitly **denies** destructive Bash patterns (`git push --force*`, `git reset --hard*`, `rm -rf*`, `prisma migrate reset*`, `neonctl branches delete*`, raw SQL `DROP/TRUNCATE/DELETE FROM`). If a routine command hits an approval prompt, propose adding it to `permissions.allow` in `.claude/settings.json` (committed) rather than `settings.local.json` so the whole team benefits.

**Plan-then-ship stop conditions specific to t9l.** The Neon-Vercel preview-env race is NOT a stop condition — admin-merge fallback is documented in [docs/known-infra-issues.md](docs/known-infra-issues.md). Data-destructive layers per [docs/release-and-ship.md](docs/release-and-ship.md) (Layer 3 Neon restore, Layers 5 / 5b / 5c Redis rebuilds) ARE stop conditions and need operator ack before proceeding.

**Auto-merge policy.** Generic policy lives in [docs/methodology.md § Auto-merge policy](docs/methodology.md#auto-merge-policy). For this repo: when shipping a PR, the executor SHOULD merge via `gh pr merge --squash --admin` without waiting for explicit user confirmation when (a) Unit + tsc tests pass, (b) post-push self-verification surfaces no issues, and (c) no architectural ambiguity was flagged. Surface for confirmation ONLY when ambiguity/risk was flagged (security trade-off, destructive migration, scope question, mid-execution stop-condition trigger). **After every self-merge, report back: PR #, merge SHA, version, what shipped, and post-deploy verification result — never go silent.** Full policy: [docs/release-and-ship.md#auto-merge-policy](docs/release-and-ship.md#auto-merge-policy).

**Version-bump target.** `APP_VERSION` in [`src/lib/version.ts`](src/lib/version.ts), with matching pin in [`tests/unit/version.test.ts`](tests/unit/version.test.ts). Post-merge tags push automatically: release tag `v<APP_VERSION>` at the merge SHA + rollback tag `v-pre-pr-N-<slug>` for the next PR.

**Admin-orthogonal-UX rule (v1.67.0).** Admin role is ORTHOGONAL to user-facing UX. The only allowed admin-specific UI is the "Admin" link in the account-menu nav and auto-auth on `/admin/*`. Everything else gates on auth state, player linkage, or membership status — NEVER on `session.isAdmin`. See [docs/admin-orthogonal-ux.md](docs/admin-orthogonal-ux.md).

**No exports from `'use server'` files (Next.js foot-gun).** Never `export const` (or any non-async value) from a file with `'use server'` at the top — Next.js converts every export into a server-action proxy on the client side, and constants become functions that crash on first use. Constants/types/interfaces shared between server actions and client components live in a separate neutral module. Standing since v1.59.2.

**Cache invalidation canonical.** Cache busts go through [`src/lib/revalidate.ts#revalidate({ domain })`](src/lib/revalidate.ts). Direct `revalidateTag` / `revalidatePath` / `updateTag` calls outside that file are forbidden; the lint guard at [`tests/unit/revalidatePrimitivesGuard.test.ts`](tests/unit/revalidatePrimitivesGuard.test.ts) fails CI if any new primitive call leaks. See [docs/cache-invalidation.md](docs/cache-invalidation.md).

**Redis cost awareness (Upstash pay-as-you-go).** Every Redis command now costs real money (upgraded from free-tier 500K/day quota). Before adding ANY new Redis read/write, estimate daily ops (per-render reads × page views, or per-write hooks × mutations). The v2.0.0 dashboard cache incident (PR #281, reverted #282) exhausted 500K ops within minutes. **Before merging any PR that adds Redis ops:** put the cost estimate in the PR description. If unsure, prefer `unstable_cache`, request-scoped `cache()`, or no caching. Existing Redis usage (RSVP / availability / auth) is load-bearing — leave alone unless explicitly optimizing. Full rule: [docs/redis-state.md § Redis cost awareness](docs/redis-state.md#redis-cost-awareness-upstash-pay-as-you-go). Generic principle: [docs/methodology.md § Cache cost awareness](docs/methodology.md#cache-cost-awareness).

**Migration SQL authoring (Prisma + `@@map` foot-gun).** Generic principle is in [docs/methodology.md § ORM migration discipline](docs/methodology.md#orm-migration-discipline). The t9l-specific command is `npx prisma migrate dev --create-only --name <name>` — Prisma resolves `@@map` / `@map` to the correct SQL table/column names; hand-authored SQL does not. Permitted exception: pure-data `UPDATE`/`INSERT` statements appended after the generated DDL, provided all table and column names are verified against `@@map` directives. See [docs/migration-sql-lessons.md](docs/migration-sql-lessons.md) for the v1.86.0 post-mortem.

**Post-deploy verification target.** Generic 3-check pattern is in [docs/methodology.md § Post-deploy verification](docs/methodology.md#post-deploy-verification--3-check-pattern). The t9l-specific recipes (curl against `https://t9l.me/`; `@neondatabase/serverless` JS for the `Account` / `User` / `League` counts; `_prisma_migrations` query) live in [docs/release-and-ship.md § Post-deploy verification](docs/release-and-ship.md#post-deploy-verification-mandatory-after-every-prod-deploy). Any failure is P0 — surface immediately and initiate rollback before doing anything else.

**Maintenance.** Architectural decisions update CLAUDE.md or the relevant `docs/*.md` **in the same PR**. PRs that touch architecture without updating docs should be sent back. Bias toward leaner — every line of bloat is a tax on every future agent.
