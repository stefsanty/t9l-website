import type { AuthOptions } from "next-auth";
import LineProvider from "next-auth/providers/line";

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
  providers: [
    LineProvider({
      clientId: process.env.LINE_CLIENT_ID ?? "",
      clientSecret: process.env.LINE_CLIENT_SECRET ?? "",
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, profile }) {
      // Set LINE-specific fields on initial sign-in
      if (account && profile) {
        token.lineId = profile.sub as string;
        token.linePictureUrl =
          ((profile as Record<string, unknown>).picture as string) ?? "";
        token.playerId = null;
        token.playerName = null;
        token.teamId = null;
      }

      // Re-check KV whenever player is not yet assigned
      // This allows the session to pick up the mapping after self-assignment
      if (token.lineId && !token.playerId) {
        const mapping = await getPlayerMapping(token.lineId as string);
        if (mapping) {
          token.playerId = mapping.playerId;
          token.playerName = mapping.playerName;
          token.teamId = mapping.teamId;
        }
      }

      return token;
    },

    async session({ session, token }) {
      session.lineId = (token.lineId as string) ?? "";
      session.playerId = (token.playerId as string | null) ?? null;
      session.playerName = (token.playerName as string | null) ?? null;
      session.teamId = (token.teamId as string | null) ?? null;
      session.linePictureUrl = (token.linePictureUrl as string) ?? "";
      return session;
    },
  },
};
