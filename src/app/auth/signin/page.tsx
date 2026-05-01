/**
 * v1.28.0 (stage α.5) — Multi-provider sign-in page.
 *
 * Replaces NextAuth's default sign-in page (set via `pages.signIn` in
 * `src/lib/auth.ts`). Surfaces the providers wired in `authOptions`:
 *   - LINE (always available in prod)
 *   - Google (only when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set)
 *   - Email magic-link (only when EMAIL_SERVER + EMAIL_FROM are set)
 *
 * The page reads the provider list from a server-side helper that mirrors
 * the env-var checks in `authOptions.providers`. Buttons are conditionally
 * rendered so users on a not-yet-fully-configured prod don't see broken
 * "Sign in with Google" UI when Google isn't actually wired.
 *
 * Admin-credentials login keeps its dedicated `/admin/login` form — it's
 * not surfaced here. This page is for public users.
 */

import { Suspense } from 'react';
import SignInClient from './SignInClient';

export const dynamic = 'force-dynamic';

function getEnabledProviders() {
  return {
    google:
      !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
    email: !!process.env.EMAIL_SERVER && !!process.env.EMAIL_FROM,
  };
}

export default function SignInPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string; error?: string };
}) {
  const enabled = getEnabledProviders();
  const callbackUrl = searchParams.callbackUrl ?? '/';
  const error = searchParams.error ?? null;
  return (
    <Suspense fallback={null}>
      <SignInClient
        googleEnabled={enabled.google}
        emailEnabled={enabled.email}
        callbackUrl={callbackUrl}
        error={error}
      />
    </Suspense>
  );
}
