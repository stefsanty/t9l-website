import type { AuthOptions } from "next-auth";
import LineProvider from "next-auth/providers/line";
import CredentialsProvider from "next-auth/providers/credentials";
import { timingSafeEqual } from "crypto";

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

async function getPlayerMapping(lineId: string): Promise<PlayerMapping | null> {
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
      }

      // Always check KV to sync with the database, allowing for unassignment
      if (token.lineId) {
        try {
          const mapping = await getPlayerMapping(token.lineId as string);
          if (mapping) {
            token.playerId = mapping.playerId;
            token.playerName = mapping.playerName;
            token.teamId = mapping.teamId;
          } else {
            // If no mapping exists in KV, clear it from the token
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
