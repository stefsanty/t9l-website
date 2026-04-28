import type { AuthOptions } from "next-auth";
import LineProvider from "next-auth/providers/line";
import CredentialsProvider from "next-auth/providers/credentials";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  getCached as getCachedMapping,
  setCached as setCachedMapping,
} from "@/lib/playerMappingCache";

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

const TEAM_ID_PREFIX = "t-";
const PLAYER_ID_PREFIX = "p-";
function stripPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

// Resolve session.{playerId, playerName, teamId} from Prisma. Player.lineId is
// the canonical link as of PR 6 (B1 migration). Player.id and LeagueTeam.team.id
// carry the "p-"/"t-" prefixes inserted by the backfill — the public-facing
// shape (and what RSVP/schedule/banner code already consumes) uses the bare
// slug, so strip prefixes here to keep session values stable across the cutover.
//
// Exported so the admin write sites in `admin/actions.ts` and
// `admin/leagues/actions.ts` can fetch the same relation-include shape post-
// write and pre-warm the JWT mapping cache (PR 9) — one source of truth for
// the slug-stripping rules.
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
    playerId: stripPrefix(player.id, PLAYER_ID_PREFIX),
    playerName: player.name,
    teamId: current ? stripPrefix(current.leagueTeam.team.id, TEAM_ID_PREFIX) : "",
  };
}

// Legacy fallback. PR 6 migrated the canonical store from Upstash Redis
// (`line-player-map` hash) to Player.lineId in Prisma. Reads still consult Redis
// when Prisma misses so any LINE user whose Redis row hasn't been backfilled
// yet (or whose Player record was deleted post-link) doesn't immediately lose
// their session. The deprecation-window console.warn marks every Redis hit so
// the operator can confirm zero hits over a soak window before deleting the
// fallback (target: PR 7+).
async function getPlayerMappingFromRedis(lineId: string): Promise<PlayerMapping | null> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null;
  }
  try {
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    const map = await redis.hget<PlayerMapping>("line-player-map", lineId);
    return map ?? null;
  } catch {
    return null;
  }
}

async function getPlayerMapping(lineId: string): Promise<PlayerMapping | null> {
  // Cache-aside: check Upstash first. Hit returns immediately and skips both
  // Prisma and the Redis fallback. Miss falls through to the canonical reads
  // and writes the result back (including null mappings via the sentinel).
  // Writers in api/assign-player, admin/leagues/actions, and admin/actions
  // call playerMappingCache.invalidate() so the cache can't outlive a write
  // beyond the racy in-flight window. See PR 8 (v1.2.3).
  const cached = await getCachedMapping(lineId);
  if (cached !== undefined) return cached.value;

  let resolved: PlayerMapping | null = null;
  try {
    const fromDb = await getPlayerMappingFromDb(lineId);
    if (fromDb) {
      resolved = fromDb;
    }
  } catch (err) {
    console.error("[auth] getPlayerMappingFromDb failed for lineId=%s: %o", lineId, err);
  }
  if (!resolved) {
    const fromRedis = await getPlayerMappingFromRedis(lineId);
    if (fromRedis) {
      console.warn("[auth] DEPRECATED Redis hit for lineId=%s — backfill row missing in Prisma", lineId);
      resolved = fromRedis;
    }
  }

  // Cache the outcome — including null — so unmapped LINE IDs don't re-hit
  // Prisma every request. Invalidation at every write site keeps this honest.
  await setCachedMapping(lineId, resolved);
  return resolved;
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
