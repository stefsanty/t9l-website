import type { AuthOptions } from "next-auth";
import LineProvider from "next-auth/providers/line";
import GoogleProvider from "next-auth/providers/google";
import EmailProvider from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  getMapping,
  setMapping,
} from "@/lib/playerMappingStore";
import { playerIdToSlug, teamIdToSlug } from "@/lib/ids";

/**
 * Resolve the cookie domain for the NextAuth session token from
 * NEXTAUTH_URL. Pure — exported for unit testing.
 *
 * v1.24.0 — multi-tenant prep PR γ. Pre-v1.24.0 NextAuth's session cookie
 * defaulted to host-only scope, so a JWT issued at `t9l.me` would not be
 * sent to `tamachi.t9l.me` and vice versa. To support cross-subdomain
 * sessions (required by the v1.22.0 / v1.23.0 multi-tenant routing), the
 * cookie domain attribute must be set to `.t9l.me`.
 *
 * Branches:
 *   - NEXTAUTH_URL host is `t9l.me` or `*.t9l.me` (incl. `dev.t9l.me`,
 *     `tamachi.t9l.me`) → return `.t9l.me`
 *   - localhost → return undefined (cookies with `domain` attribute don't
 *     work on localhost; browsers silently reject them)
 *   - Vercel preview hosts (`*.vercel.app`) → return undefined (the
 *     preview's session cookie is single-host scoped — multi-tenant flows
 *     are tested against the prod domain)
 *   - missing or malformed NEXTAUTH_URL → return undefined (defensive)
 *
 * Domain migration runbook: when migrating from `t9l.me` to a new domain,
 * update this function to match the new apex (e.g. `host.endsWith('.example.com')`)
 * AND update every consumer in CLAUDE.md's "Domain migration runbook"
 * section. This is the single source of truth for the cookie scope.
 */
export function getAuthCookieDomain(): string | undefined {
  const url = process.env.NEXTAUTH_URL;
  if (!url) return undefined;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  // Match `t9l.me` apex AND any subdomain of t9l.me. Localhost, Vercel
  // preview hosts, and any other domain fall through to host-only scope.
  if (host === "t9l.me" || host.endsWith(".t9l.me")) {
    return ".t9l.me";
  }
  return undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

type PlayerMapping = {
  playerId: string;
  playerName: string;
  teamId: string;
};

// Resolve session.{playerId, playerName, teamId} from Prisma. As of PR 16 /
// v1.5.0, Prisma is the **durable secondary** for the `lineId → Player`
// mapping — Redis (`playerMappingStore`) is the canonical store consulted on
// every JWT callback. Prisma is read here in three places: (1) admin write
// sites that pre-warm the Redis store after a write, (2) the defensive
// fallback inside `getPlayerMapping` when Redis is _unreachable_ (not just
// missing — see file head of `playerMappingStore.ts`), and (3) the recovery
// script `scripts/backfillRedisFromPrisma.ts` that rebuilds Redis from
// Player.lineId rows on demand.
//
// Player.id and LeagueTeam.team.id carry the "p-"/"t-" prefixes inserted by
// the PR 6 backfill — the public-facing shape (and what RSVP/schedule/banner
// code already consumes) uses the bare slug, so strip prefixes here to keep
// session values stable across the cutover. One source of truth for the
// slug-stripping rules; admin write sites + the v1.5.0 backfill script all
// route through this function.
//
// v1.26.0 — `leagueId` parameter resolves the per-league
// `PlayerLeagueAssignment`. When supplied, the function picks the open
// assignment (`toGameWeek IS NULL`) within that league, falling back to the
// most-recent past assignment for that league, falling back to `teamId: ""`
// (player exists globally but has no roster slot in this league — the
// caller should treat them as "linked but team-less for this league"; the
// Dashboard's existing render-null branches handle this gracefully).
//
// When `leagueId` is omitted, the legacy "first open assignment" behavior
// is preserved (only used by the admin write paths that don't know a single
// league context — e.g. `updatePlayer` / `createPlayer` — and which call
// `deleteMapping(lineId)` to invalidate the per-league cache and lazy-fill
// on next read).
export async function getPlayerMappingFromDb(
  lineId: string,
  leagueId?: string | null,
): Promise<PlayerMapping | null> {
  const player = await prisma.player.findUnique({
    where: { lineId },
    include: {
      leagueAssignments: {
        include: { leagueTeam: { include: { team: true } } },
        orderBy: { fromGameWeek: "desc" },
      },
    },
  });
  if (!player) return null;

  let assignment;
  if (leagueId) {
    // Per-league resolution. Prefer the open assignment for this league;
    // fall back to the most-recent past assignment in this league. Past
    // assignments give a sensible "your previous team in this league" view
    // even after the player rotates out — better than the empty-string
    // fallback for a player who's still associated with the league.
    assignment =
      player.leagueAssignments.find(
        (a) => a.leagueTeam.leagueId === leagueId && a.toGameWeek === null,
      ) ??
      player.leagueAssignments.find((a) => a.leagueTeam.leagueId === leagueId) ??
      null;
  } else {
    // Legacy / league-blind: pre-v1.26.0 behavior. Used only by admin write
    // paths that need the player's "primary" team for a generic Redis
    // pre-warm (and even those are migrating to per-league at write time).
    assignment =
      player.leagueAssignments.find((a) => a.toGameWeek === null) ??
      player.leagueAssignments[0] ??
      null;
  }

  return {
    playerId: playerIdToSlug(player.id),
    playerName: player.name,
    teamId: assignment ? teamIdToSlug(assignment.leagueTeam.team.id) : "",
  };
}

/**
 * Resolve `lineId → Player` from the v1.5.0 architecture: Redis is canonical;
 * Prisma is the defensive fallback only when Redis is unreachable.
 *
 *   hit   → return value (mapping or null sentinel — both are authoritative)
 *   miss  → return null  (orphan; pre-v1.5.0 fell through to Prisma, no more)
 *   error → fall through to Prisma so an Upstash transient outage doesn't
 *           null every authenticated session for the duration of the blip.
 *           The fallback result is written back to Redis on success so the
 *           next request hits the store directly.
 *
 * The legacy `getPlayerMappingFromRedis` (line-player-map hash, PR 6
 * deprecation window) was retired in v1.5.0 — every LINE user was migrated
 * to `Player.lineId` by the PR 6 backfill, and the v1.5.0 store reads from a
 * different namespace (`t9l:auth:map:`) so there is no remaining role for
 * the legacy hash. The `legacyRedisCleanup` calls in `api/assign-player`
 * still HDEL the legacy hash defensively on every link/unlink so any
 * residual entries decay to empty.
 */
// Exported under the `__` prefix as the test seam — production code reads
// the mapping via the JWT callback which calls `getPlayerMapping` internally.
// Unit test in `tests/unit/getPlayerMapping.test.ts` pins the tri-state
// branches without mounting next-auth.
//
// v1.26.0 — `leagueId` is required because the read path is now per-league.
// Tests that ran without a leagueId pre-v1.26.0 got league-blind data;
// post-v1.26.0 they need to pass an explicit league context.
export async function __getPlayerMapping_for_testing(
  lineId: string,
  leagueId: string,
): Promise<PlayerMapping | null> {
  return getPlayerMapping(lineId, leagueId);
}

async function getPlayerMapping(
  lineId: string,
  leagueId: string,
): Promise<PlayerMapping | null> {
  const result = await getMapping(lineId, leagueId);

  if (result.status === 'hit') {
    return result.value;
  }

  if (result.status === 'miss') {
    // v1.26.0 — per-league key namespace. A miss is now ambiguous (cold
    // per-(leagueId, lineId) cache vs genuine orphan in this league), so
    // fall through to Prisma + write back. Mirror of v1.7.0's RSVP store
    // miss policy (per-GameWeek key, miss → Prisma + write-back).
    try {
      const fromDb = await getPlayerMappingFromDb(lineId, leagueId);
      // Pre-warm Redis with the result so the next request hits the store
      // directly. Best-effort — silent on Redis failure (the auth callback
      // has the answer it needs regardless).
      await setMapping(lineId, leagueId, fromDb);
      return fromDb;
    } catch (err) {
      console.error(
        "[auth] getPlayerMappingFromDb failed in miss-fallthrough for lineId=%s leagueId=%s: %o",
        lineId,
        leagueId,
        err,
      );
      return null;
    }
  }

  // Redis is unreachable / errored. Fall back to Prisma defensively to keep
  // existing sessions alive through transient Upstash outages. Do NOT write
  // back on error — don't amplify an Upstash blip into a write storm
  // against the same unhealthy endpoint.
  console.warn(
    "[auth] playerMappingStore unreachable (reason=%s); falling through to Prisma for lineId=%s leagueId=%s",
    result.reason,
    lineId,
    leagueId,
  );
  try {
    return await getPlayerMappingFromDb(lineId, leagueId);
  } catch (err) {
    console.error(
      "[auth] getPlayerMappingFromDb failed in store-error fallback for lineId=%s leagueId=%s: %o",
      lineId,
      leagueId,
      err,
    );
    return null;
  }
}

// v1.28.0 (stage α.5) — bridge between the adapter-managed User row and
// the legacy `User.lineId @unique` column. The PrismaAdapter creates User
// rows with `{ name, email, image }` but does NOT touch our custom
// `lineId` column. This helper sets `User.lineId = lineId` IF currently
// null on the User row, idempotent and tolerant of races (two concurrent
// JWT callbacks won't conflict — one of them no-ops).
//
// Why we don't use `prisma.user.update`: a straight update would race-
// fail under concurrent first-login refreshes (both fire, second hits the
// unique constraint). `updateMany WHERE lineId IS NULL` makes the second
// call a silent no-op.
//
// Why we don't use `upsert`: the User row already exists (created by the
// adapter). We're only filling in our custom column.
//
// Stage 4 retires this helper alongside `User.lineId` itself.
async function syncUserLineId(userId: string, lineId: string): Promise<void> {
  await prisma.user.updateMany({
    where: { id: userId, lineId: null },
    data: { lineId },
  });
}

// Upsert a LineLogin row on every authenticated request. Powers the admin
// "Assign Player" Flow B orphan-user dropdown. Failure is non-fatal — auth
// must not block on the tracking write.
async function trackLineLogin(
  lineId: string,
  name: string | null | undefined,
  pictureUrl: string | null | undefined,
): Promise<void> {
  try {
    await prisma.lineLogin.upsert({
      where: { lineId },
      create: {
        lineId,
        name: name ?? null,
        pictureUrl: pictureUrl ?? null,
      },
      update: {
        // Refresh metadata when LINE returns updated values; never overwrite
        // a known good value with null (LINE may omit fields on token refresh).
        ...(name ? { name } : {}),
        ...(pictureUrl ? { pictureUrl } : {}),
      },
    });
  } catch (err) {
    console.error("[auth] trackLineLogin failed for lineId=%s: %o", lineId, err);
  }
}

// v1.24.0 — cross-subdomain session cookie config. The `__Secure-` name
// prefix requires `secure: true`, which the browser enforces on HTTPS only.
// On localhost (HTTP) we fall back to the default unprefixed name so the
// dev login flow still works.
const useSecureAuthCookies = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;
const authCookieDomain = getAuthCookieDomain();

// v1.28.0 (stage α.5) — Google OAuth + EmailProvider (magic link) wired
// behind env-var presence checks so a misconfigured prod doesn't crash on
// signin-page render. If the relevant env var is unset, the provider is
// omitted from the providers array entirely. Operators can ship α.5 to
// prod with the env vars unset; LINE OAuth + admin-credentials continue to
// work, and Google/email signup paths are simply unavailable until vars
// land. This is the load-bearing safety property that lets the
// infrastructure rollout proceed without operator-side coordination on
// the env vars (per user instruction 2026-05-02).
const googleProviderEnabled =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
const emailProviderEnabled =
  !!process.env.EMAIL_SERVER && !!process.env.EMAIL_FROM;

export const authOptions: AuthOptions = {
  // v1.28.0 — Wire NextAuth's PrismaAdapter for multi-provider Account
  // management (Google OAuth + EmailProvider magic link). Session strategy
  // remains JWT (load-bearing for v1.5.0 Redis-canonical mapping store and
  // v1.24.0 cross-subdomain cookie scope) — adapter no-ops session methods
  // under JWT strategy per NextAuth v4 docs.
  //
  // Adapter manages: User upserts, Account upserts (the multi-provider
  // join), VerificationToken round-trips for EmailProvider. The Account
  // table is what makes "one User can sign in with LINE OR Google OR
  // email" work uniformly — every successful sign-in produces a
  // (provider, providerAccountId) row keyed on the same User.id.
  //
  // First-login-post-α.5 behavior for existing LINE users:
  //   The adapter has no Account row for them (the table didn't exist
  //   pre-α.5), and there's no `User` row to match by email either (the
  //   User table was dormant for the public flow pre-α.5). So the adapter
  //   creates a fresh User + Account. The `syncUserLineId` bridge below
  //   then sets `User.lineId = profile.sub` so the legacy lineId-based
  //   resolver path keeps working through stage 3 (γ).
  //
  // The companion backfill script `scripts/backfillAccountFromLineLogin.ts`
  // can pre-stage User+Account rows for every existing Player.lineId so
  // stage β has data to dual-write into immediately. Run it post-deploy
  // (the migration must apply first to create the Account table). The
  // backfill is idempotent and safe to re-run; it's an optimization, not
  // a hard merge gate.
  adapter: PrismaAdapter(prisma),

  pages: {
    signIn: '/auth/signin',
    error: '/auth-error',
    verifyRequest: '/auth/verify-request',
  },
  cookies: {
    // Session token (JWT) — set the domain attribute when running on a
    // *.t9l.me host so the JWT is shared across subdomains. csrfToken keeps
    // its default host-only scope (NextAuth uses the __Host- prefix on it
    // when secure, which forbids the domain attribute by spec).
    sessionToken: {
      name: useSecureAuthCookies
        ? `__Secure-next-auth.session-token`
        : `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureAuthCookies,
        ...(authCookieDomain ? { domain: authCookieDomain } : {}),
      },
    },
    // Callback URL — also cross-subdomain so a sign-in initiated on a
    // subdomain redirects back correctly after the LINE OAuth round-trip.
    callbackUrl: {
      name: useSecureAuthCookies
        ? `__Secure-next-auth.callback-url`
        : `next-auth.callback-url`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureAuthCookies,
        ...(authCookieDomain ? { domain: authCookieDomain } : {}),
      },
    },
  },
  providers: [
    LineProvider({
      clientId: process.env.LINE_CLIENT_ID ?? "",
      clientSecret: process.env.LINE_CLIENT_SECRET ?? "",
    }),
    // v1.28.0 (stage α.5) — Google OAuth. Enabled only when env vars
    // are present; omitted entirely otherwise so an unconfigured prod
    // doesn't crash the signin page. allowDangerousEmailAccountLinking
    // is intentionally NOT enabled — preventing automatic Account
    // merging across providers by email is a defense against an
    // attacker creating a Google account with a victim's email and
    // taking over their LINE-only account.
    ...(googleProviderEnabled
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          }),
        ]
      : []),
    // v1.28.0 (stage α.5) — EmailProvider (magic link). Enabled only
    // when EMAIL_SERVER + EMAIL_FROM are set. NextAuth handles the
    // entire token round-trip via the VerificationToken table; the
    // adapter consumes the token on click and creates User + Account.
    ...(emailProviderEnabled
      ? [
          EmailProvider({
            server: process.env.EMAIL_SERVER!,
            from: process.env.EMAIL_FROM!,
            // Default 10-minute token expiry from NextAuth is fine.
          }),
        ]
      : []),
    CredentialsProvider({
      id: "admin-credentials",
      name: "Admin",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const expectedUser = process.env.ADMIN_USERNAME;
        const expectedPass = process.env.ADMIN_PASSWORD;
        if (!expectedUser || !expectedPass) {
          console.error("[auth] ADMIN_USERNAME / ADMIN_PASSWORD not set");
          return null;
        }
        if (!credentials?.username || !credentials?.password) return null;
        const userOk = safeEqual(credentials.username, expectedUser);
        const passOk = safeEqual(credentials.password, expectedPass);
        if (!userOk || !passOk) return null;
        return {
          id: `admin:${expectedUser}`,
          name: "Admin",
          email: null,
          image: null,
        };
      },
    }),
    // Dev-only credentials provider for easy account switching
    ...(process.env.NODE_ENV === "development"
      ? [
          CredentialsProvider({
            id: "dev-login",
            name: "Dev Login",
            credentials: {
              playerId: { label: "Player ID", type: "text" },
              playerName: { label: "Player Name", type: "text" },
              teamId: { label: "Team ID", type: "text" },
            },
            async authorize(credentials) {
              if (!credentials) return null;
              return {
                id: `dev-${credentials.playerId}`,
                name: credentials.playerName,
                playerId: credentials.playerId,
                teamId: credentials.teamId,
              };
            },
          }),
        ]
      : []),
    // LINE ID mock provider — active only when NEXTAUTH_DEV_MODE=true (Vercel Preview dev branch)
    ...(process.env.NEXTAUTH_DEV_MODE?.trim() === "true"
      ? [
          CredentialsProvider({
            id: "line-mock",
            name: "LINE ID Mock",
            credentials: {
              lineId: { label: "LINE ID", type: "text" },
            },
            async authorize(credentials) {
              if (!credentials?.lineId) return null;
              const { lineId } = credentials;
              return {
                id: lineId,
                name: `Dev User (${lineId})`,
                email: null,
                image: null,
              };
            },
          }),
        ]
      : []),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, profile, user }) {
      // Handle admin username/password login — bypass LINE flow entirely
      if (account?.provider === "admin-credentials" && user) {
        token.authProvider = "admin-credentials";
        token.isAdmin = true;
        token.name = user.name ?? "Admin";
        return token;
      }
      // Preserve admin session on subsequent refreshes (no account on refresh)
      if (token.authProvider === "admin-credentials") {
        token.isAdmin = true;
        return token;
      }

      // Handle Dev Login
      if (account?.provider === "dev-login" && user) {
        token.lineId = user.id;
        token.playerId = (user as any).playerId;
        token.playerName = user.name;
        token.teamId = (user as any).teamId;
        token.linePictureUrl = "";
        return token;
      }

      // Handle line-mock: set lineId and fall through to Redis lookup + isAdmin
      if (account?.provider === "line-mock" && user) {
        token.lineId = user.id;
        token.linePictureUrl = "";
      }

      // v1.28.0 (stage α.5) — non-LINE adapter-managed providers.
      // For Google + email sign-ins, the PrismaAdapter has already created
      // (or matched) the User + Account rows by the time this callback
      // fires. NextAuth passes us the resolved `user` object whose `id` is
      // the User.id. Capture it for forward use; these users do NOT have a
      // lineId, no Player association yet (until they redeem a
      // LeagueInvite — PRs #6/#7), and no playerId/teamId on the JWT.
      // They land on `/` signed in but as logged-in lurkers with no league
      // context. The picker / RSVP / invite redemption flows handle the
      // null playerId case via Dashboard's existing render-null branches.
      if (
        (account?.provider === "google" || account?.provider === "email") &&
        user
      ) {
        token.userId = user.id;
        token.lineId = undefined;
        token.linePictureUrl = "";
        token.playerId = null;
        token.playerName = null;
        token.teamId = null;
        token.authProvider = account.provider;
        // Capture name/email/picture for client display surfaces. Google
        // gives us all three; EmailProvider gives only email.
        if (user.name) token.name = user.name;
        if (user.email) token.email = user.email;
        return token;
      }

      // Set LINE-specific fields on initial sign-in
      if (account && profile && account.provider === "line") {
        console.log('[auth] LINE sign-in: provider=%s sub=%s', account.provider, profile.sub);
        token.lineId = profile.sub as string;
        token.linePictureUrl =
          ((profile as Record<string, unknown>).picture as string) ?? "";
        token.playerId = null;
        token.playerName = null;
        token.teamId = null;
        // v1.28.0 — capture User.id from the adapter-created User row so
        // β's dual-write knows which User to bind to a Player. The adapter
        // has already created (or matched, post-pre-α.5-backfill) the
        // User row by the time we're here, and NextAuth passes us the
        // resolved `user` object on initial sign-in.
        if (user?.id) {
          token.userId = user.id;
          // v1.28.0 (stage α.5) — bridge: the PrismaAdapter doesn't know
          // about our custom `User.lineId` column (it's outside NextAuth's
          // canonical User shape). On first LINE sign-in the adapter
          // creates a User with lineId=null. Set it now so that:
          //   (a) the legacy `User.lineId @unique` resolver path keeps
          //       working through stage 3 (γ),
          //   (b) the pre-α.5 backfill running post-deploy can find this
          //       User via lineId on its next pass,
          //   (c) β's dual-write logic that resolves "the User for this
          //       lineId" via User.lineId remains valid.
          // Tolerant of repeat-fire: if already set to this lineId, no-op
          // at the DB layer (updateMany with where: lineId IS NULL avoids
          // the unique-violation race when two parallel callbacks try to
          // set the same value).
          await syncUserLineId(user.id, token.lineId as string).catch((err) =>
            console.error(
              "[auth] syncUserLineId failed userId=%s lineId=%s: %o",
              user.id,
              token.lineId,
              err,
            ),
          );
        }
        // Track this login in Prisma — first-seen population for Flow B.
        await trackLineLogin(
          token.lineId as string,
          (profile as Record<string, unknown>).name as string | undefined,
          (profile as Record<string, unknown>).picture as string | undefined,
        );
      }

      // v1.26.0 — resolve the active league from the request host on every
      // JWT callback so navigating across subdomains updates the per-league
      // mapping deterministically. apex / dev base / localhost / Vercel
      // preview → default league id; known subdomain → that league's id;
      // unknown subdomain → null (no league context — null out player/team
      // fields rather than serving cross-league data).
      //
      // Lazy import to keep the helper out of the static import graph for
      // non-request-context callers (the recovery script, etc.).
      let requestLeagueId: string | null = null;
      try {
        const { getLeagueIdFromRequest } = await import("@/lib/getLeagueFromHost");
        requestLeagueId = await getLeagueIdFromRequest();
      } catch (err) {
        console.error("[auth] getLeagueIdFromRequest failed in JWT callback: %o", err);
      }
      token.leagueId = requestLeagueId;

      // Always check the canonical mapping (Redis-canonical, Prisma fallback
      // on miss/error per v1.26.0 semantics) so the session reflects
      // admin-driven (re)assignments and unassignments.
      if (token.lineId) {
        if (!requestLeagueId) {
          // No league context (apex with no default-league flag set, or
          // unknown subdomain). Serve the linked user as logged-in but with
          // no team — Dashboard's render-null branches treat this as
          // "guest" for in-team affordances, which is the safest behavior.
          token.playerId = null;
          token.playerName = null;
          token.teamId = null;
        } else {
          try {
            const mapping = await getPlayerMapping(
              token.lineId as string,
              requestLeagueId,
            );
            if (mapping) {
              token.playerId = mapping.playerId;
              token.playerName = mapping.playerName;
              token.teamId = mapping.teamId;
            } else {
              token.playerId = null;
              token.playerName = null;
              token.teamId = null;
            }
          } catch (err) {
            console.error(
              "[auth] getPlayerMapping failed for lineId=%s leagueId=%s: %o",
              token.lineId,
              requestLeagueId,
              err,
            );
          }
        }
      }

      // Recompute isAdmin on every token refresh so env changes take effect
      const adminIds = (process.env.ADMIN_LINE_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      token.isAdmin =
        adminIds.length > 0 && !!token.lineId && adminIds.includes(token.lineId as string);

      return token;
    },

    async session({ session, token }) {
      session.lineId = (token.lineId as string) ?? "";
      session.playerId = (token.playerId as string | null) ?? null;
      session.playerName = (token.playerName as string | null) ?? null;
      session.teamId = (token.teamId as string | null) ?? null;
      session.linePictureUrl = (token.linePictureUrl as string) ?? "";
      session.isAdmin = (token.isAdmin as boolean) ?? false;
      // v1.26.0 — surface the league context the JWT was resolved against
      // so client components can verify which league their session.teamId
      // refers to. Optional consumer convenience; the playerId/teamId
      // fields are already per-league correct.
      session.leagueId = (token.leagueId as string | null) ?? null;
      // v1.28.0 (stage α.5) — surface the canonical User.id when the
      // session has one. Stage β's dual-write keys on this; the upcoming
      // /join/[code] flow keys on this; the future header league switcher
      // (PR #8) keys on this. Null for admin-credentials sessions and for
      // the (transient) state between sign-in start and adapter resolution.
      session.userId = (token.userId as string | null) ?? null;
      return session;
    },
  },
};
