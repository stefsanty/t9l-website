import type { DefaultSession, DefaultJWT } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    lineId: string;
    playerId: string | null;
    playerName: string | null;
    teamId: string | null;
    linePictureUrl: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    lineId?: string;
    playerId?: string | null;
    playerName?: string | null;
    teamId?: string | null;
    linePictureUrl?: string;
  }
}
