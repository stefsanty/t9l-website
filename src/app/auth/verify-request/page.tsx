/**
 * v1.28.0 (stage α.5) — Email magic-link "check your inbox" landing page.
 *
 * NextAuth's EmailProvider routes here after the user submits their email
 * on `/auth/signin`. The user clicks the link in their email, which goes
 * to `/api/auth/callback/email?token=…`, the adapter validates and
 * consumes the VerificationToken, and the user lands signed-in on the
 * configured callbackUrl (default `/`).
 *
 * If the user never clicks the link, the token expires after 10 minutes
 * (NextAuth default) and they have to start over.
 */

import Link from 'next/link';

export default function VerifyRequestPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-5">
      <div className="w-full max-w-sm bg-card border border-border-default rounded-3xl overflow-hidden shadow-2xl">
        <div className="px-7 pt-6 pb-8 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-2">
            T9L
          </p>
          <h1 className="font-display text-2xl font-black uppercase tracking-tight text-fg-high leading-tight mb-3">
            Check your email
          </h1>
          <p className="text-sm text-fg-mid mb-5">
            We just sent you a sign-in link. Click it to finish signing in. The
            link expires in 10 minutes.
          </p>
          <p className="text-[11px] text-fg-mid leading-snug mb-5">
            If you don&apos;t see it, check your spam folder.
          </p>
          <Link
            href="/auth/signin"
            className="text-[11px] font-bold uppercase tracking-[0.15em] text-fg-mid hover:text-fg-high transition-colors"
          >
            Try a different method
          </Link>
        </div>
      </div>
    </div>
  );
}
