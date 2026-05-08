# CLAUDE.md

T9L.me — mobile-first website for the Tennozu 9-Aside League, a recreational football league in Tokyo. Multi-tenant: a single Vercel deployment serves multiple leagues, each at `/id/<slug>`. Players sign in (LINE / Google / email magic-link), claim a Player record, RSVP availability for matchdays, and view live league data backed by Postgres (Neon) + Upstash Redis.

**Current release:** v1.80.9.

## Documentation

Topical docs live under `docs/`. Read the relevant one before working in that area.

| Topic | File |
|-------|------|
| Architecture, file structure, env vars, public id conventions | [docs/architecture.md](docs/architecture.md) |
| Prisma schema + identity model (User/Player/PLM/Account) | [docs/data-model.md](docs/data-model.md) |
| State-on-Redis pattern (playerMappingStore, rsvpStore) | [docs/redis-state.md](docs/redis-state.md) |
| NextAuth, providers, JWT callback, recruit/onboarding flows | [docs/auth.md](docs/auth.md) |
| Time handling (JST conventions) | [docs/time-handling.md](docs/time-handling.md) |
| Cache invalidation (revalidate canonical) | [docs/cache-invalidation.md](docs/cache-invalidation.md) |
| Testing (Vitest, Playwright, regression-target, stash-pop) | [docs/testing.md](docs/testing.md) |
| Release & ship process (autonomy, rollback layers 1–5c) | [docs/release-and-ship.md](docs/release-and-ship.md) |
| Admin-orthogonal-UX standing rule | [docs/admin-orthogonal-ux.md](docs/admin-orthogonal-ux.md) |
| Known infra issues (Neon-Vercel race, Vercel body cap, V8 TZ trap) | [docs/known-infra-issues.md](docs/known-infra-issues.md) |
| Domain migration runbook | [docs/domain-migration-runbook.md](docs/domain-migration-runbook.md) |
| Ledger archive (older PRs, snapshot table, ops events) | [docs/ledger-archive.md](docs/ledger-archive.md) |

## Stale-worktree protocol — FIRST ACTION OF EVERY FRESH SESSION

**Parent first, worktree second.** The parent repo's local `main` needs to track `origin/main` so future worktrees inherit fresh state; THEN the worktree's branch rebases on `origin/main` to pick up everything since spawn. Skipping the parent step fixes the current worktree but leaves the next worktree spawn on the same stale base.

```
git -C /Users/stefan/t9l-website fetch --all --prune
git -C /Users/stefan/t9l-website pull --ff-only origin main
git rebase origin/main   # in the worktree
```

Every Claude Code session is spawned in a worktree branched off the parent repo's *local* `main`, which routinely lags behind `origin/main` as PRs merge upstream. Without the rebase, the entire CLAUDE.md / file structure / git log / dependency surface you observe is a stale snapshot. Multiple prior sessions have flagged plan inputs as fictional and stopped, when in fact rebasing onto `origin/main` revealed all the referenced files were already shipped.

**Procedure:**
1. **Fast-forward the parent's `main` to `origin/main` first** via the `git -C` commands above. If `pull --ff-only` fails (parent has uncommitted changes, or local `main` has diverged from `origin/main`), STOP and surface to the user. Do NOT force, do NOT `reset --hard`, do NOT switch branches inside the parent — divergent parent state means the operator has uncommitted work or an in-progress branch and needs to resolve manually.
2. **Then rebase the worktree onto `origin/main`.** Run *before* any reading or analysis of the briefing.
3. **If `git rebase` reports conflicts in the worktree, STOP and surface to the user.** Do not attempt to resolve, force, abort-and-reset, or otherwise paper over divergent state.
4. **If both succeed (or are no-op fast-forwards), proceed with the task as briefed.** Re-read CLAUDE.md from scratch — everything you "remembered" from the pre-rebase state may be wrong.
5. **If the rebase reveals files / tags / version constants the briefing references that you previously couldn't see, that's the expected path — execute the briefing.** A briefing matching post-rebase state is the strongest signal it's legitimate, not the weakest.

The cost of pausing to rebase is seconds; the cost of refusing real work in front of a backlog of merged PRs is multi-session drag.

## Standing rules

**Autonomy.** The Claude Code harness reads `.claude/settings.json` (committed) and `.claude/settings.local.json` (gitignored). The committed file pre-approves routine read/edit/grep/install/test/git/gh/vercel/neonctl tools and explicitly **denies** destructive Bash patterns (`git push --force*`, `git reset --hard*`, `rm -rf*`, `prisma migrate reset*`, `neonctl branches delete*`, raw SQL `DROP/TRUNCATE/DELETE FROM`). If a routine command is hitting an approval prompt, propose adding it to `permissions.allow` in `.claude/settings.json` rather than `settings.local.json` so the whole team benefits.

**Plan-then-ship.** Plans grounded in code audit + tests that verify the planned behavior may proceed to ship without orchestrator ack. The audit-grounded plan IS the gate — surface scope, identify the load-bearing bug, lay out tests that fail on the broken state, then ship sequentially through the planned PR list. **Stop conditions still apply:** data destruction (Layer 3 / 5 / 5b / 5c), schema irreversibility, prod write surprise, ambiguity that's actually a product decision. The Neon-Vercel preview-env race is NOT a stop condition — admin-merge fallback is documented in [docs/known-infra-issues.md](docs/known-infra-issues.md).

**Version bump.** Every PR bumps `APP_VERSION` in `src/lib/version.ts`. Patch (1.1.0 → 1.1.1) for fixes/chores/refactors/docs; minor (→ 1.2.0) for new user-visible features; major (→ 2.0.0) for breaking changes. The matching test in `tests/unit/version.test.ts` updates in the same commit. Post-merge tags push automatically: release tag `v<APP_VERSION>` at the merge SHA + rollback tag `v-pre-pr-N-<slug>` for the next PR.

**Per-push reporting.** Surface a one-line status to the orchestrator at three points per PR:
1. **On push:** `> PR #N pushed: <one-line>. <merge state>. Next: <PR M or smoke step>.`
2. **On merge:** `> PR #N merged at <SHA>. Tag v<X.Y.Z> pushed. Waiting for prod deploy.`
3. **On prod live:** `> v<X.Y.Z> live on apex.`

Keep each line short. Long explanations live in PR descriptions, not chat.

**Test rule.** Every PR that adds or changes behavior ships with at least one test that proves the new behavior. Unit (Vitest) for pure functions; e2e (Playwright) for user-visible flows. CI runs Vitest + tsc on every PR; merge is blocked on red.

**End-to-end verification.** Tests must verify the BEHAVIOR the PR claims to fix, not just that the code compiles. Regression-target tests must **fail on the broken state** — verify with a stash-pop sanity check before claiming the test catches it. "Doesn't crash" is not verification.

**Maintenance.** Architectural decisions update CLAUDE.md or the relevant `docs/*.md` **in the same PR**. PRs that touch architecture without updating docs should be sent back. Bias toward leaner — every line of bloat is a tax on every future agent.

**Admin-orthogonal-UX rule (v1.67.0).** Admin role is ORTHOGONAL to user-facing UX. The only allowed admin-specific UI is the "Admin" link in the account-menu nav and auto-auth on `/admin/*`. Everything else gates on auth state, player linkage, or membership status — NEVER on `session.isAdmin`. See [docs/admin-orthogonal-ux.md](docs/admin-orthogonal-ux.md).

**No exports from `'use server'` files.** Never `export const` (or any non-async value) from a file with `'use server'` at the top — Next.js converts every export into a server-action proxy on the client side, and constants become functions that crash on first use. Constants/types/interfaces shared between server actions and client components live in a separate neutral module. Standing since v1.59.2.

**Cache invalidation canonical.** Cache busts go through [`src/lib/revalidate.ts#revalidate({ domain })`](src/lib/revalidate.ts). Direct `revalidateTag` / `revalidatePath` / `updateTag` calls outside that file are forbidden; the lint guard at [`tests/unit/revalidatePrimitivesGuard.test.ts`](tests/unit/revalidatePrimitivesGuard.test.ts) fails CI if any new primitive call leaks. See [docs/cache-invalidation.md](docs/cache-invalidation.md).

**Bash discipline.** Never chain bash commands. Use separate Bash tool calls for each step instead of `cmd1 && cmd2`, `cmd1; cmd2`, or `cmd1 $(cmd2)`. Chained commands match the allow-list matcher against the full string and frequently trigger permission prompts that block the agent in a waiting loop. For directory scoping, use `git -C /path/to/repo` instead of `cd /path && git ...`.

## Recent ledger (top 20 PRs)

- **v1.80.9** — perf phase 4d: lazy-load sonner's `<Toaster />` from `app/layout.tsx` via `next/dynamic` in a `'use client'` wrapper (`components/ToasterMount.tsx`). Pre-v1.80.9 the static `import { Toaster } from "sonner"` pulled the full sonner bundle (~36 KB raw / ~10 KB gz) into the public root chunk on every page load — even though the Toaster is DOM-empty until a `toast(...)` call fires. Same lazy-load pattern as the v1.80.8 modal fix. Per-route post-v1.80.8→v1.80.9 first-load JS measurements (`route-bundle-stats.json`, gzipped sum of `firstLoadChunkPaths`): `/_not-found`, `/[slug]`, `/league/[slug]`, `/matchday/[id]`, `/recruit/[slug]`, `/join/[code]/onboarding`: -8,252 gz each (~31 KB raw); `/stats`: -8,985 gz; `/`, `/id/[slug]`, `/id/[slug]/md/[id]`: +594 gz (sonner is preloaded as an async chunk for routes that share Recruiting/Header dependency clusters — Turbopack chunking trade-off; net loss is small versus the 7-route win). Total weighted savings across public routes: ~5-7 KB gz on average. Stash-pop verified: regression-target tests in `perfPhase4d.test.ts` fail when `<Toaster>` is re-injected into `app/layout.tsx`
- **v1.80.8** — perf phase 4c: lazy-load auth modals (`SignInLightbox`, `ApplyToLeagueModal`) via `next/dynamic` — they were statically imported by `Header → LineLoginButton`, `RecruitingBanner`, and `GuestLoginBanner` but only mount after user click. Header chunk 1347: 27,577 → 21,509 parsed (-6,068 / -1,059 gz) on every public page. Dashboard chunk 7206: 33,725 → 26,174 parsed (-7,551 / -2,203 gz) on the landing page. Modals now ship as their own async chunks (~9 KB SignInLightbox, ~5 KB ApplyToLeagueModal) that fetch only when opened. JSX gated on the open-state booleans so the deferred chunks don't fetch on mount.
- **v1.80.7** — perf phase 4b: bundle analyzer audit — `leagueSlug.ts` and `leagueDetails.ts` were dragging `@prisma/client/runtime/index-browser.js` (~47 KB parsed / ~17 KB gzip) into the public bundle on every route because client components legitimately imported pure exports (`DEFAULT_LEAGUE_SLUG`, `BALL_TYPE_LABELS`, etc.) from files that also `import { prisma }`. Split DB-cached lookups into `leagueSlugServer.ts` + `leagueDetailsServer.ts`; pure types/constants/helpers stay in the original modules. Total client bundle: -49,225 bytes parsed / -17,632 bytes gzip. Zero `@prisma/*` references remaining in `.next/static/chunks` (was 47 KB)
- **v1.80.6** — perf phase 4: LCP fix (Barlow Condensed `display: 'optional'` — kills the late font-swap re-paint that pinned LCP to the matchday `<h2>`) + admin-only fonts (Barlow Sans, DM Mono) lifted out of public root layout (~50 KiB woff2 transferred saved per first load) + drop unused weight 400 from Barlow Condensed (~10 KiB saved) + `@next/bundle-analyzer` wired (`ANALYZE=true npx next experimental-analyze`)
- **v1.80.5** — perf phase 3: Google Translate gated behind locale (EN visitors skip the GT bundle entirely — removes el_main_css from PSI critical path) + browserslist config drops SWC legacy polyfills (Array.prototype.at, Object.fromEntries, etc.); LCP fix deferred via [docs/perf-phase3-lcp-handoff.md](docs/perf-phase3-lcp-handoff.md)
- **v1.80.4** — perf phase 3: `sizes=` on 6 `<Image fill />` callers (PlayerAvatar, UserTeamBadge, MatchdayCard, SquadList, LeagueTable, TopPerformers) so next/image stops serving 3840px variants for 12-64px slots; defensive `take: 5000` on goal/matchEvent/leagueInvite findMany in admin-data
- **v1.80.3** — perf phase 2: `next/dynamic` for below-fold widgets — Dashboard (MatchdayAvailability/LeagueDetailsPanel/PlannedRosterStats/RsvpBar/SubmitGoalForm/CompressedMatchdaySchedule) + /stats (TopPerformers/SquadList); H2 font pruning deferred (every candidate weight has callers)
- **v1.80.2** — perf phase 1: bfcache reload deleted, /stats fetches parallelized, public-data revalidate 30s→300s, 3 oversized PNGs re-encoded (~966 KB saved)
- **v1.80.1** — sign out preserves current page via getCurrentCallbackUrl()
- **v1.80.0** — comments field on onboarding form + admin display
- **v1.79.3** — combine Season Fee + Register By onto one dt/dd row in LeagueDetailsPanel
- **v1.79.2** — fix Register By row alignment (split onto own table-aligned row)
- **v1.79.1** — send approval email when admin approves application
- **v1.79.0** — Applicant-received email on registration + onboarding
- **v1.78.0** — required email field on registration form (recruit + onboarding)
- **v1.77.1** — `registerToLeague` calls `redirect()` server-side on success
- **v1.76.1** — ID upload callout (explain why ID is needed before file inputs)
- **v1.76.0** — RecruitingBanner State E uses SignInLightbox instead of toast+signIn
- **v1.75.8** — Consistent column alignment in Planned Season Schedule
- **v1.75.7** — League details polish + Goal kick field

Older entries condensed in [docs/ledger-archive.md](docs/ledger-archive.md).

## Working with subagents

1. **Match model to task.** Trivial CSS / copy / single-line edits run on Sonnet or Haiku. Reserve Opus for substantial refactors or anything where context can balloon.
2. **CLAUDE.md trim discipline.** Every PR that adds a rule should also remove or condense redundant text elsewhere.
3. **Smaller, focused PRs in parallel.** Different subagents in parallel beat one large sequential agent.
4. **Diagnose-then-execute split.** Research/audit/debug is its own session; findings get passed to a separate executor subagent.
5. **PLAN.md and TODO.md at repo root.** Subagents reference and rewrite them as they ship PRs.
6. **Subagent context isolation.** A subagent reads N files and returns a 5-line summary; orchestrator sees only the summary.
7. **Concise responses.** Bias terse over thorough. Long explanations live in PR descriptions, not chat.
