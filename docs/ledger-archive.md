# Ledger archive

The most recent ~20 PRs are summarized one-line in CLAUDE.md. Older versions of the recent ledger are condensed below for historical context. Full PR descriptions live in `git log` and the GitHub PR bodies.

## Per-PR snapshot ledger

Append-only record of merge commits, git tags, and prod deploy URLs for rollback purposes.

| PR | Merge commit | Git tag | Prod deploy URL | Schema delta / rollback |
|----|--------------|---------|-----------------|-------------------------|
| 49 (PR ζ onboarding redemption — v1.34.0) | TBD | `v-pre-pr-50-next` | TBD | Additive: 2 new enums + 3 new columns. |
| 50 (PR η ID upload — v1.35.0) | TBD | `v-pre-pr-51-next` | TBD | Additive: 3 nullable columns. Operator gate: `BLOB_READ_WRITE_TOKEN`. |
| 51 (PR θ admin Reset Onboarding — v1.36.0) | TBD | `v-pre-pr-52-next` | TBD | Code-only. |
| 52 (PR ι: `/account/player` + `Player.profilePictureUrl` — v1.37.0) | `72bd7c8` | `v-pre-pr-53-next` | https://t9l-website-pd8exllie-t9l-app.vercel.app | Additive: 1 nullable column. |
| 53 (PR κ: admin player list redesign — v1.38.0) | `338e898` | `v-pre-pr-54-next` | https://t9l-website-q7c8mtqt2-t9l-app.vercel.app | Code-only. |
| 54 (PR λ: identity unification audit — v1.39.0) | `5189050` | `v-pre-pr-55-next` | https://t9l-website-c105hqsto-t9l-app.vercel.app | Code-only. |
| 55 (non-LINE picker gate fix — v1.39.2) | `aba56ba` | `v-pre-pr-56-next` | https://t9l-website-onpacn77l-t9l-app.vercel.app | Code-only. |
| 56 (invite-page inline auth — v1.40.0) | `e6cf759` | `v-pre-pr-57-next` | https://t9l-website-mrb2wzrxa-t9l-app.vercel.app | Code-only. |
| 57 (admin Players tab edit-mode — v1.41.0) | TBD | `v-pre-pr-58-next` | TBD | Code-only. |
| 58 (per-league `allowSelfLink` toggle — v1.60.0) | TBD | `v-pre-pr-59-next` | TBD | Additive: 1 column on League. |
| v1.71.0 (Sheets surface retirement) | TBD | `v-pre-v1.72-next` | TBD | Code-only: deletes Sheets client + parsers + admin toggles + `googleapis` dep. |

Future PRs append rows.

## Operational events

One-shot ops on shared systems (Redis cleanup, manual DB writes outside a migration). Most-recent-5 retained; older entries live in git history.

- **2026-04-30** — v1.25.0 deploy (renderer convergence): apex + subdomain unified onto `Dashboard`; `LeaguePublicView` deleted.
- **2026-04-30** — v1.21.x deploys (schedule tab visual taxonomy + time-only kickoff picker). Both admin-merged through Neon-Vercel race fallback.
- **2026-04-29** — v1.12.0 cleanup deploy. Shared `lib/ids.ts` + `rsvpStoreSchema.ts`, archived `backfillRedisLineMap`, flipped `dataSource` fallback to `'db'`.
- **2026-04-28** — Pre-merge prod cutover for v1.7.0 (RSVP-on-Redis): ran `backfillRedisRsvpFromPrisma --apply`, 12 GameWeeks seeded.
- **2026-04-28** — Dropped orphan Redis `line-player-map` entries surfaced by PR 6 backfill.

## Older ledger (pre-v1.78.0; condensed)

Each line is a one-paragraph summary. Drill into git log + PR body for full details.

### v1.71.x – v1.79.x — Cleanup, recruitment polish, league details

- **v1.79.3** — combine Season Fee + Register By onto one dt/dd row in LeagueDetailsPanel
- **v1.79.2** — fix Register By row alignment (split onto own table-aligned row)
- **v1.79.1** — send approval email when admin approves application
- **v1.79.0** — Applicant-received email on registration + onboarding
- **v1.78.0** — required email field on registration form (recruit + onboarding)
- **v1.77.1** — `registerToLeague` calls `redirect()` server-side on success
- **v1.76.1** — ID upload callout (explain why ID is needed)
- **v1.76.0** — RecruitingBanner State E uses SignInLightbox instead of toast+signIn
- **v1.75.0–v1.75.8** — League details settings + preseason public display + consolidation chain
- **v1.74.0/1** — Replace legacy 'All Teams' admin link with real `/admin/teams-all` CRUD + color picker
- **v1.73.x** — Team logos to rounded squares + standardize across surfaces; preseason schedule logos
- **v1.71.x** — Vercel platform body cap fix (client-direct upload pattern); Sheets surface retirement
- **v1.70.x** — ID images moved from Player to User (per-person, not per-league)

### v1.50–v1.69 — Path-routing chain, identity rework, recruiting flows

- **v1.67.x** — Planned roster / Player fee / synthetic invite bug fix (deferred to /recruit/[slug])
- **v1.65–v1.66** — Identity rework finalization: Player.userId @unique, drop legacy fields
- **v1.64.x** — Application workflow (PLM status PENDING/APPROVED/DECLINED)
- **v1.62–v1.63** — Recruiting/preseason mode toggles + RecruitingBanner
- **v1.60–v1.61** — Per-league `allowSelfLink` toggle + non-LINE provider self-link unification
- **v1.59.x** — Streaming loading skeletons + SSR-hydrated league switcher + admin gate fixes
- **v1.58.x** — `/admin` load perf + Vercel preview-build root-cause fix
- **v1.54–v1.57** — Route shortening to `/id/<slug>`; admin UI compat audit; cross-league Players linking; `/admin/users`
- **v1.53.x** — Subdomain teardown; deleted `getLeagueFromHost.ts`; admin reserved-word validation
- **v1.50–v1.52** — Path-based routing scaffold; canonical matchday URL; league switcher UI

### v1.30–v1.49 — Multi-tenant prep, identity rework α/β/γ, admin tabs

- **v1.46–v1.49** — Match events epic (PR α through ζ): admin CRUD, public read-flip, player self-report
- **v1.42.x** — Match events PR α/β: additive `MatchEvent` schema + Goals backfill
- **v1.41.x** — Admin Players tab edit-mode redesign + position editor
- **v1.40.0** — Invite-page inline auth (`JoinInlineAuth`)
- **v1.34–v1.39** — Onboarding redemption (PR ζ–κ): `/join/[code]` foundation, ID upload, admin Reset, `/account/player`, identity unification audit
- **v1.32–v1.33** — Multi-provider login lightbox; admin invite generation
- **v1.27–v1.31** — Identity rework α/β/γ: User↔Player schema + dual-write + read-flip + Setting flag
- **v1.22–v1.26** — Multi-tenant prep α/β/γ: parameterize `getPublicLeagueData`, JWT league context, renderer convergence

### v1.0–v1.29 — Foundation, Sheets cutover, RSVP/auth Redis inversion

- **v1.16–v1.21** — Cache invalidation consolidation; admin schedule tab redesign; venue dropdown; admin player rename
- **v1.7–v1.15** — RSVP-on-Redis inversion (v1.7); auth lineId→Player Redis-canonical (v1.5); JST helpers (v1.9); MatchScoreEditor extraction; ratings drop
- **v1.0–v1.6** — Sheets→DB cutover (PRs 1–4): schema, backfill+adapter+dispatcher, toggle UI, operational `dataSource='db'` flip; saving-stuck UX fixes; admin Flow B + LineLogin model
