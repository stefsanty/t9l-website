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
    /**
     * v1.28.0 (stage α.5) — canonical User.id for the signed-in human,
     * resolved through the PrismaAdapter regardless of which provider
     * (LINE / Google / email) signed them in. Null for admin-credentials
     * sessions (admin auth doesn't go through the adapter) and for the
     * transient state between sign-in start and adapter resolution.
     *
     * Load-bearing for stage β's dual-write (User.playerId ↔ Player.userId)
     * and for the upcoming /join/[code] LeagueInvite redemption flow.
     */
    userId: string | null;
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
    /**
     * v1.28.0 (stage α.5) — see `Session.userId` above. Captured from the
     * adapter-resolved User.id on initial sign-in for any provider, and
     * passed through on session refresh.
     */
    userId?: string | null;
  }
}
