import Link from 'next/link';

// next-auth error codes and what they mean
const ERROR_DESCRIPTIONS: Record<string, string> = {
  OAuthSignin: 'Could not start the LINE sign-in flow. Check that LINE_CLIENT_ID and LINE_CLIENT_SECRET are correct.',
  OAuthCallback: 'Error handling the response from LINE. The callback URL may not be whitelisted in the LINE Developer Console, or NEXTAUTH_URL may be wrong.',
  OAuthCreateAccount: 'Could not create an account after LINE sign-in.',
  Callback: 'Error in the auth callback handler. Check Vercel logs for details.',
  OAuthAccountNotLinked: 'This LINE account is already linked to a different user.',
  AccessDenied: 'Access was denied during the LINE sign-in flow.',
  Verification: 'The sign-in link has expired or already been used.',
  Default: 'An unexpected error occurred during sign-in.',
};

export default function AuthErrorPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const code = searchParams.error ?? 'Default';
  const description = ERROR_DESCRIPTIONS[code] ?? ERROR_DESCRIPTIONS.Default;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-5">
      <div className="w-full max-w-sm bg-card border border-border-default rounded-3xl overflow-hidden shadow-2xl">
        <div className="px-7 pt-6 pb-8">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-2">
            Sign-in error
          </p>
          <h1 className="font-display text-2xl font-black uppercase tracking-tight text-fg-high leading-tight mb-3">
            Login failed
          </h1>

          <div className="bg-surface rounded-2xl px-4 py-3 mb-4">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-fg-mid mb-1">
              Error code
            </p>
            <p className="text-sm font-mono font-bold text-primary">{code}</p>
          </div>

          <p className="text-sm text-fg-mid leading-relaxed mb-6">
            {description}
          </p>

          <Link
            href="/"
            className="flex items-center justify-center w-full py-3.5 rounded-2xl bg-electric-green text-black font-display text-base font-black uppercase tracking-wider hover:bg-electric-green/90 active:scale-[0.98] transition-all"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
