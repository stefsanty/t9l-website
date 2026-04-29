import type { AuthOptions } from "next-auth";
import LineProvider from "next-auth/providers/line";
import CredentialsProvider from "next-auth/providers/credentials";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  getMapping,
  setMapping,
} from "@/lib/playerMappingStore";
import { playerIdToSlug, teamIdToSlug } from "@/lib/ids";

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
export async function getPlayerMappingFromDb(lineId: string): Promise<PlayerMapping | null> {
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
  const current =
    player.leagueAssignments.find((a) => a.toGameWeek === null) ??
    player.leagueAssignments[0] ??
    null;
  return {
    playerId: playerIdToSlug(player.id),
    playerName: player.name,
    teamId: current ? teamIdToSlug(current.leagueTeam.team.id) : "",
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
// the mapping via the JWT callback which calls `getPlayerMapping` internally
// (see line 87). Unit test in `tests/unit/getPlayerMapping.test.ts` pins the
// tri-state branches without mounting next-auth.
export async function __getPlayerMapping_for_testing(
  lineId: string,
): Promise<PlayerMapping | null> {
  return getPlayerMapping(lineId);
}

async function getPlayerMapping(lineId: string): Promise<PlayerMapping | null> {
  const result = await getMapping(lineId);

  if (result.status === 'hit') {
    return result.value;
  }

  if (result.status === 'miss') {
    // Canonical "no mapping". Pre-v1.5.0 this fell through to Prisma; the
    // v1.5.0 architecture treats the store as authoritative — orphans
    // re-link via /assign-player or wait for an admin to assign them.
    return null;
  }

  // Redis is unreachable / errored. Fall back to Prisma defensively to keep
  // existing sessions alive through transient Upstash outages. On success,
  // pre-warm the store so the next request finds it directly. Errors here
  // (Prisma failure) are logged and the user is treated as orphan — same
  // failure mode as pre-v1.5.0.
  console.warn(
    "[auth] playerMappingStore unreachable (reason=%s); falling through to Prisma for lineId=%s",
    result.reason,
    lineId,
  );
  try {
    const fromDb = await getPlayerMappingFromDb(lineId);
    // Best-effort pre-warm. If Redis is still down, this is a no-op — the
    // store helper swallows write errors. Either way, the auth callback
    // already has the answer it needs.
    await setMapping(lineId, fromDb);
    return fromDb;
  } catch (err) {
    console.error(
      "[auth] getPlayerMappingFromDb failed in store-error fallback for lineId=%s: %o",
      lineId,
      err,
    );
    return null;
  }
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

export const authOptions: AuthOptions = {
  pages: {
    signIn: '/admin/login',
    error: '/auth-error',
  },
  providers: [
    LineProvider({
      clientId: process.env.LINE_CLIENT_ID ?? "",
      clientSecret: process.env.LINE_CLIENT_SECRET ?? "",
    }),
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

      // Set LINE-specific fields on initial sign-in
      if (account && profile) {
        console.log('[auth] LINE sign-in: provider=%s sub=%s', account.provider, profile.sub);
        token.lineId = profile.sub as string;
        token.linePictureUrl =
          ((profile as Record<string, unknown>).picture as string) ?? "";
        token.playerId = null;
        token.playerName = null;
        token.teamId = null;
        // Track this login in Prisma — first-seen population for Flow B.
        await trackLineLogin(
          token.lineId as string,
          (profile as Record<string, unknown>).name as string | undefined,
          (profile as Record<string, unknown>).picture as string | undefined,
        );
      }

      // Always check the canonical mapping (Prisma → Redis fallback) so the
      // session reflects admin-driven (re)assignments and unassignments.
      if (token.lineId) {
        try {
          const mapping = await getPlayerMapping(token.lineId as string);
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
          console.error('[auth] getPlayerMapping failed for lineId=%s: %o', token.lineId, err);
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
      return session;
    },
  },
};
