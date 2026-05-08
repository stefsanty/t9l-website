# Domain migration runbook

If the apex domain ever migrates from `t9l.me` to a different domain. Each layer has a specific action; some can be done independently, others must be sequenced.

**Note (post-v1.54.0):** subdomain routing was torn down in v1.53.0. Wildcard DNS / wildcard Vercel domain entries are no longer needed for tenant routing — every league lives at `/id/<slug>` on the apex. The wildcard entries are left in place to avoid breaking any operator URL still bookmarked, but they have no app-side semantic post-v1.54.0.

## Layer 1 — DNS

Update DNS at the domain registrar:
- Apex `A` (or `ALIAS`/`ANAME`) record pointing at Vercel (`76.76.21.21` for IP-based, or the canonical Vercel-managed CNAME).
- Optional: wildcard `*.<newdomain>` `CNAME` for any subdomain bookmarks still in use (no app-side semantic post-v1.54.0).
- Keep the old domain's DNS in place during cutover — Vercel can serve both simultaneously while traffic shifts.

## Layer 2 — Vercel project config

In the Vercel dashboard for `t9l-website`:
- Add the new domain (`<newdomain>`) under Settings → Domains.
- Verify the SSL certificate provisions (Let's Encrypt via Vercel auto-provisioning).
- Optionally set the new domain as the production redirect target so the old domain auto-redirects post-cutover.
- Remove the old domain only after Layer 3–8 are complete and validated.

## Layer 3 — `NEXTAUTH_URL` env var

Update on **prod AND preview** Vercel envs:
```
NEXTAUTH_URL=https://<newdomain>
```
Load-bearing for [`getAuthCookieDomain()`](../src/lib/auth.ts) — see Layer 5. NextAuth v4 also uses `NEXTAUTH_URL` to construct the OAuth callback URL.

Local dev (`.env.local`): leave as `http://localhost:3000` — the cookie helper falls through to host-only on localhost.

## Layer 4 — LINE OAuth callback URL

In the LINE Developer Console:
- Add `https://<newdomain>/api/auth/callback/line` to the allowlist.
- Keep the old `https://t9l.me/api/auth/callback/line` until Layer 8 completes.

Same shape applies to Google OAuth (Google Cloud Console → OAuth consent screen → Authorized redirect URIs) and Resend (email magic-link sender domain config).

## Layer 5 — NextAuth cookie domain

Update [`getAuthCookieDomain()`](../src/lib/auth.ts) — flip the apex match from `t9l.me` to the new apex:
```diff
- if (host === "t9l.me" || host.endsWith(".t9l.me")) {
-   return ".t9l.me";
+ if (host === "<newdomain>" || host.endsWith(".<newdomain>")) {
+   return ".<newdomain>";
  }
```
Update the test in [`tests/unit/authCookieDomain.test.ts`](../tests/unit/authCookieDomain.test.ts). Bump `APP_VERSION`.

## Layer 6 — Hardcoded URL literals

Grep for the old domain across the entire repo (single tool call, no chained pipes):
```bash
grep -rn "t9l\.me" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" .
```

Replace each occurrence with the new domain. Surfaces:
- `src/` — code
- `scripts/` — deploy/seed/backfill
- Tests (`tests/unit/**`, `tests/e2e/**`)
- `CLAUDE.md` and `docs/`
- `package.json` `homepage` / `repository` / `bugs` URLs
- `playwright.config.ts` `baseURL` default
- `next.config.{js,ts,mjs}`

## Layer 7 — Other env vars referencing the domain

- `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_BASE_URL` (currently not used; flag for future)
- Vercel-managed Preview-env URLs (auto-generated; no action)
- `BLOB_READ_WRITE_TOKEN` and `KV_REST_API_URL` are domain-independent

## Layer 8 — Cache + session invalidation

Once the cutover code merges and prod is serving from the new domain:
- Players currently signed in via LINE OAuth need to re-authenticate. The session JWT cookie was scoped to `.t9l.me`; on `.<newdomain>` it's a fresh cookie scope. Communicate this ahead of cutover.
- Optionally flush prod Upstash (`t9l:auth:map:*` namespace) — not strictly required (the mappings are domain-agnostic).
- Neon `Player.lineId` / `User.email` rows are domain-agnostic — no action.
- The `googtrans` cookie (Google Translate) is host-scoped by default; users will re-pick their language on first visit.

## Layer 9 — CLAUDE.md + docs/

Update references to the apex domain across CLAUDE.md and `docs/`. Layer 6 grep should catch most of them; double-check section headings, code comments, example URLs.

## Sequencing

Layers 1–4 are prep work and can land independently in any order. Layer 5 (cookie domain) is the load-bearing code change — ship it AS the cutover commit, with the corresponding `NEXTAUTH_URL` flip in the same Vercel deploy. Layers 6–9 are cleanup.

Cutover sequence that minimizes downtime:
1. Layers 1–2 (DNS + Vercel domain attached, both old and new active)
2. Layer 4 (LINE/Google/email OAuth callbacks added; old retained)
3. Layer 6 (code references updated, but Layer 5 cookie domain still on the old domain — deploy this)
4. Layer 5 + Layer 3 in the same commit + Vercel env update — the cutover
5. Layer 8 — operator action: communicate re-auth, flush caches if desired
6. Layer 4 — remove old OAuth callbacks
7. Layer 2 — remove old domain from Vercel
