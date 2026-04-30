import type { DefaultSession, DefaultJWT } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    lineId: string;
    playerId: string | null;
    playerName: string | null;
    teamId: string | null;
    linePictureUrl: string;
    isAdmin: boolean;
    /**
     * v1.26.0 — the league context the session.{playerId, teamId} were
     * resolved against. Set by the JWT callback from the request Host
     * header on every refresh. `null` when the request comes from a host
     * that doesn't map to any league (apex with no default-league flag,
     * or unknown subdomain).
     */
    leagueId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    lineId?: string;
    playerId?: string | null;
    playerName?: string | null;
    teamId?: string | null;
    linePictureUrl?: string;
    isAdmin?: boolean;
    authProvider?: string;
    /**
     * v1.26.0 — see `Session.leagueId` above. Stored on the JWT for
     * pass-through to the session callback; recomputed on every JWT
     * callback, not persisted across cookie issuance (the callback
     * always re-reads the Host header).
     */
    leagueId?: string | null;
  }
}
