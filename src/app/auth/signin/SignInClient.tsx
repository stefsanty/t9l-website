'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

interface Props {
  googleEnabled: boolean;
  emailEnabled: boolean;
  callbackUrl: string;
  error: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked:
    'This account is already linked to a different sign-in method. Try the original method, or contact support to merge.',
  EmailSignin:
    'We could not send the sign-in email. Try again, or use a different method.',
  Default: 'Sign-in failed. Try again.',
};

export default function SignInClient({
  googleEnabled,
  emailEnabled,
  callbackUrl,
  error,
}: Props) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email || submitting) return;
    setSubmitting(true);
    await signIn('email', { email, callbackUrl });
    // signIn redirects to /auth/verify-request on success — control
    // flow here only resumes on failure paths (network blip, etc.).
    setSubmitting(false);
  }

  const errorMessage = error
    ? ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default
    : null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-5">
      <div className="w-full max-w-sm bg-card border border-border-default rounded-3xl overflow-hidden shadow-2xl">
        <div className="px-7 pt-6 pb-8">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-2">
            T9L
          </p>
          <h1 className="font-display text-2xl font-black uppercase tracking-tight text-fg-high leading-tight mb-3">
            Sign in
          </h1>
          <p className="text-sm text-fg-mid mb-6">
            Pick how you want to sign in.
          </p>

          {errorMessage ? (
            <div className="mb-5 rounded-2xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300">
              {errorMessage}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => signIn('line', { callbackUrl })}
            className="w-full mb-3 flex items-center justify-center gap-2 rounded-2xl bg-[#06C755] px-5 py-3 text-white font-bold shadow-lg hover:opacity-90 transition-opacity"
          >
            <span aria-hidden="true">L</span>
            <span>Continue with LINE</span>
          </button>

          {googleEnabled ? (
            <button
              type="button"
              onClick={() => signIn('google', { callbackUrl })}
              className="w-full mb-3 flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-gray-900 font-bold shadow-lg hover:opacity-90 transition-opacity"
              data-testid="signin-google"
            >
              <span aria-hidden="true">G</span>
              <span>Continue with Google</span>
            </button>
          ) : null}

          {emailEnabled ? (
            <>
              <div className="my-5 flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-fg-mid">
                <span className="flex-1 h-px bg-border-default" />
                <span>or</span>
                <span className="flex-1 h-px bg-border-default" />
              </div>

              <form onSubmit={onSubmitEmail} className="flex flex-col gap-3">
                <label
                  htmlFor="email"
                  className="text-[10px] font-black uppercase tracking-[0.15em] text-fg-mid"
                >
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-2xl bg-surface border border-border-default px-4 py-3 text-sm text-fg-high placeholder:text-fg-mid focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={submitting}
                  data-testid="signin-email-input"
                />
                <button
                  type="submit"
                  disabled={!email || submitting}
                  className="w-full rounded-2xl bg-primary px-5 py-3 text-bg-high font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                  data-testid="signin-email-submit"
                >
                  {submitting ? 'Sending…' : 'Send sign-in link'}
                </button>
                <p className="text-[11px] text-fg-mid leading-snug">
                  We&apos;ll email you a one-shot link. No password.
                </p>
              </form>
            </>
          ) : null}

          <div className="mt-6 text-center">
            <Link
              href="/"
              className="text-[11px] font-bold uppercase tracking-[0.15em] text-fg-mid hover:text-fg-high transition-colors"
            >
              Back home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
