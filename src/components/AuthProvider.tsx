'use client';

import { SessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';

interface AuthProviderProps {
  children: React.ReactNode;
  /**
   * v1.49.0 — server-resolved session, threaded from `app/layout.tsx` via
   * `getServerSession(authOptions)`. When provided, `SessionProvider` skips
   * the initial `/api/auth/session` round-trip and returns this seed value
   * synchronously from `useSession()` on first render. Eliminates the
   * post-paint flash where auth-aware UI (UserTeamBadge, RsvpBar with
   * playerId, Submit Goal CTA, header dropdown) appeared 300ms-1s after
   * the page rendered.
   *
   * Cost is unchanged in total wall-clock time: the JWT callback runs
   * server-side instead of client-side, in parallel with the page's RSC
   * data fetch (Next parallelizes layout + page). The user just sees the
   * correct UI on first paint instead of a re-render later.
   */
  session?: Session | null;
}

export default function AuthProvider({ children, session }: AuthProviderProps) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
