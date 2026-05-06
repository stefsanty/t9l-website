# PLAN.md

Upcoming work + open architectural questions. Subagents reference and rewrite this as PRs ship and decisions land. Keep scannable; no verbose preamble.

## Upcoming

- **Player fee admin UI** — operator can already see the v1.67.1 player-fee row on the public PlannedRosterStats panel, but admin UI to set `League.defaultFee` + per-position `LeaguePositionFee` rows in League settings is pending. Today these values are written via raw SQL or seed scripts only. (Deferred from v1.66.0.)
- **Apex routing for multi-league users** (open question, raised in v1.67.1 diagnosis). Stefan sees Classic League Homepage at apex while another user member of a preseason league sees the preseason view via `/id/<slug>`. Apex `/` always serves the default league regardless of session — by design (per v1.53.0 subdomain teardown). Three options if Stefan wants apex to be more user-aware: (a) auth-aware redirect when user has approved membership in a non-default recruiting/preseason league; (b) prefer preseason/recruiting leagues as a tiebreaker in `getDefaultLeagueId`; (c) "you're viewing the X league — switch to Y" UX hint. Confirm with operator before shipping.
- **Sheets parser retirement** (deferred per v1.0.x note). Once `dataSource='db'` has soaked further, retire `writeMode='sheets-only'`/`'dual'` modes and delete the legacy Sheets parser path entirely. PR 41+ in the Sheets→DB migration ledger.
- **Multi-tenant launch operator runbook** (queued from v1.26.0 closing note). Three operator-side items remain: (1) admin UX for attaching subdomains to leagues, (2) per-subdomain DNS provisioning runbook, (3) production cutover runbook for the first non-default-league subdomain.
- **Identity rework Stage Δ** (queued post-v1.30.0). Drop `Player.lineId`, drop legacy resolver, drop drift detector — only after operator flips `Setting('identity.read-source')` to `'user'` and the new path soaks 3-4 weeks.
- **`User.image` ↔ `Player.pictureUrl` consolidation** (deferred from v1.70.0 "stage 4" of auth chain).
- **Profile picture moderation policy** (carried from v1.39.1 post-PR todos). Pending.

## Open architectural questions

- **`@relation` FKs between `User.playerId` and `Player.id`** (deferred from v1.39.0 audit). Symmetric `@relation` declarations with both `fields/references` are rejected by Prisma; converting either side to a real FK requires picking a single owning direction. Best done after stage Δ retires `Player.lineId`.
- **Per-league cache-bust tags** for `unstable_cache`. Currently every league shares the `public-data` / `leagues` tag set, so admin writes on one league bust caches on all. `unstable_cache` requires static tags at definition time; per-league busting would force per-league wrapper instantiation. Evaluated and skipped in v1.23.0; revisit if multi-tenant cardinality grows.
