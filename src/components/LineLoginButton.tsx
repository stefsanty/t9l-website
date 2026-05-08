'use client';

import { useSession, signIn, signOut } from 'next-auth/react';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import { APP_VERSION } from '@/lib/version';
import SignInLightbox from './SignInLightbox';
import { getCurrentCallbackUrl } from '@/lib/signInCallbackUrl';

const GUEST_DISMISSED_KEY = 't9l-guest-dismissed';

function LineIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596a.603.603 0 0 1-.199.031c-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595a.657.657 0 0 1 .194-.033c.195 0 .375.105.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
    </svg>
  );
}

function AssignModal({ onDismiss }: { onDismiss: () => void }) {
    return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-5">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onDismiss}
      />

      {/* Card */}
      <div className="relative w-full max-w-sm mx-auto bg-card border border-border-default rounded-3xl overflow-hidden shadow-2xl animate-in">

        <div className="px-7 pt-5 pb-8">
          {/* Icon */}
          <div className="w-14 h-14 rounded-2xl bg-[#06C755]/10 border border-[#06C755]/20 flex items-center justify-center mb-5">
            <LineIcon className="w-7 h-7 text-[#06C755]" />
          </div>

          <h2 className="font-display text-3xl font-black uppercase tracking-tight text-fg-high leading-tight">
            {"You're logged in!"}
          </h2>
          <p className="text-sm text-fg-mid mt-2 leading-relaxed">
            {"Link your LINE account to your player profile to RSVP to matchdays and show your photo in the squad list."}
          </p>

          {/* CTA */}
          <Link
            href="/assign-player"
            className="flex items-center justify-center gap-2 w-full mt-6 py-4 rounded-2xl bg-electric-green text-black font-display text-lg font-black uppercase tracking-wider hover:bg-electric-green/90 active:scale-[0.98] transition-all"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {"Assign to my player"}
          </Link>

          {/* Guest link */}
          <button
            onClick={onDismiss}
            className="w-full mt-4 text-[13px] text-fg-mid hover:text-fg-high transition-colors py-2"
          >
            {"Continue as guest"}
          </button>
        </div>
      </div>
    </div>
  );
}


export default function LineLoginButton() {
    const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showSignInLightbox, setShowSignInLightbox] = useState(false);
  // v1.70.3 — capture the current page path at click time so the OAuth
  // round-trip returns the user to whichever league subpage they
  // triggered sign-in from (pre-v1.70.3 callbackUrl defaulted to '/'
  // and dropped /id/<slug> context).
  const [signInCallbackUrl, setSignInCallbackUrl] = useState('/');

  function openSignInLightbox() {
    setSignInCallbackUrl(getCurrentCallbackUrl());
    setShowSignInLightbox(true);
  }
  const ref = useRef<HTMLDivElement>(null);

  // Show the assign modal on first login (no player assigned, not previously dismissed).
  //
  // v1.61.0 — gate on `allowSelfLink` instead of `session.lineId`. The
  // /assign-player route now accepts non-LINE sessions (Google / email)
  // when the league's `allowSelfLink` toggle is on. When the toggle is
  // off, the modal stays hidden — directing users to /assign-player only
  // to land on the disabled surface would be confusing UX. Any
  // authenticated session with no playerId AND allowSelfLink === true
  // sees the popup once (until they dismiss it).
  useEffect(() => {
    if (
      status === 'authenticated' &&
      session?.allowSelfLink &&
      !session?.playerId &&
      (session?.lineId || session?.userId)
    ) {
      const dismissed = localStorage.getItem(GUEST_DISMISSED_KEY);
      if (!dismissed) {
        setShowAssignModal(true);
      }
    }
  }, [status, session?.lineId, session?.userId, session?.playerId, session?.allowSelfLink]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handleVisitAsGuest() {
    localStorage.setItem(GUEST_DISMISSED_KEY, '1');
    setShowAssignModal(false);
  }

  if (status === 'loading') {
    return <div className="w-8 h-8 rounded-full bg-surface-md animate-pulse" />;
  }

  if (!session) {
    const isLocalDev = process.env.NODE_ENV === 'development';
    const isDevMode = process.env.NEXT_PUBLIC_DEV_MODE === 'true';

    // v1.32.1 / PR δ.1 — In prod the button opens the multi-provider
    // lightbox (the "Other ways" text link is removed; the LINE branding
    // is removed). In local dev the existing impersonation dropdown
    // stays — it's a separate purpose (dev workflow, not provider pick).
    return (
      <>
        <div className="flex items-center gap-2">
          <div className="relative" ref={ref}>
            <button
              onClick={() => {
                if (isLocalDev) {
                  setOpen(!open);
                } else {
                  openSignInLightbox();
                }
              }}
              className="bg-[#06C755] hover:bg-[#05b34c] active:scale-95 text-white text-[11px] font-black uppercase tracking-wider px-3 md:px-4 py-1.5 rounded-full transition-all"
              data-testid="header-signin"
            >
              {"Sign in"}
            </button>

            {open && isLocalDev && (
            <div className="absolute right-0 top-full mt-2 w-52 bg-card border border-border-default rounded-2xl overflow-hidden z-50 shadow-2xl">
              <button
                onClick={() => { setOpen(false); openSignInLightbox(); }}
                className="w-full flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-fg-high hover:text-fg-mid hover:bg-surface transition-colors border-b border-border-subtle"
              >
                {"Open sign-in lightbox"}
              </button>

              <div className="px-3 py-3 bg-surface">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-fg-mid mb-2 px-1">{"Dev Shortcuts"}</p>
                <div className="grid grid-cols-1 gap-1">
                  {[
                    { id: 'ian-noseda', name: 'Ian Noseda', teamId: 'mariners-fc' },
                    { id: 'ivo-rodrigues', name: 'Ivo Rodrigues', teamId: 'fenix-fc' },
                    { id: 'ryohei-enomoto', name: 'Ryohei Enomoto', teamId: 'hygge-sc' },
                    { id: 'riki-imai', name: 'Riki Imai', teamId: 'fc-torpedo' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => signIn('dev-login', {
                        playerId: p.id,
                        playerName: p.name,
                        teamId: p.teamId,
                        callbackUrl: '/'
                      })}
                      className="text-left px-2 py-1.5 rounded-lg text-[10px] font-bold text-fg-mid hover:text-electric-green hover:bg-electric-green/5 transition-all truncate"
                    >
                      {"Impersonate:"} {p.name}
                    </button>
                  ))}
                  <button
                    onClick={() => signIn('dev-login', {
                      playerId: 'guest-dev',
                      playerName: 'Guest Dev',
                      teamId: '',
                      callbackUrl: '/assign-player'
                    })}
                    className="text-left px-2 py-1.5 rounded-lg text-[10px] font-bold text-fg-mid hover:text-primary hover:bg-primary/5 transition-all truncate"
                  >
                    {"Login as Guest (No Player)"}
                  </button>
                </div>
              </div>
            </div>
          )}
          </div>

          {isDevMode && !isLocalDev && (
            <Link
              href="/dev-login"
              className="text-[10px] font-black uppercase tracking-wider text-yellow-400 border border-yellow-400/30 hover:border-yellow-400/60 hover:text-yellow-300 px-2.5 py-1.5 rounded-full transition-all"
            >
              Dev
            </Link>
          )}
        </div>
        <SignInLightbox open={showSignInLightbox} onClose={() => setShowSignInLightbox(false)} callbackUrl={signInCallbackUrl} />
      </>
    );
  }

  const needsSetup = !session.playerId;
  // v1.61.0 — `/assign-player` accepts any authenticated session (LINE,
  // Google, email) when the league's `allowSelfLink` toggle is on. The
  // gate is per-league via `session.allowSelfLink` (computed in the JWT
  // callback). When OFF, the dropdown shows the friendly "Need an invite"
  // message instead of the picker CTA.
  const allowSelfLink = session.allowSelfLink !== false; // default-true

  return (
    <>
      {/* First-login lightbox — rendered via portal to escape header's transform stacking context */}
      {showAssignModal && createPortal(
        <AssignModal onDismiss={handleVisitAsGuest} />,
        document.body,
      )}

      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          className="relative w-8 h-8 rounded-full overflow-hidden border-2 border-electric-green/40 hover:border-electric-green transition-colors focus:outline-none"
          aria-label="Account menu"
        >
          {session.linePictureUrl ? (
            <Image
              src={session.linePictureUrl}
              alt="Profile"
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="w-full h-full bg-electric-green/10 flex items-center justify-center text-electric-green text-xs font-black">
              {session.playerName?.[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          {needsSetup && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-primary rounded-full border-2 border-background" />
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-52 bg-card border border-border-default rounded-2xl overflow-hidden z-50 shadow-2xl">
            {needsSetup ? (
              <div className="px-4 py-3 border-b border-border-subtle">
                <p className="text-[10px] font-black uppercase tracking-widest text-fg-mid">{"Signed in as guest"}</p>
                <p className="text-xs text-fg-high mt-0.5">
                  {allowSelfLink ? "No player assigned yet" : "Need an invite to join"}
                </p>
              </div>
            ) : (
              <div className="px-4 py-3 border-b border-border-subtle">
                <p className="text-[10px] font-black uppercase tracking-widest text-fg-mid">{"Playing as"}</p>
                <p className="text-sm font-black text-fg-high mt-0.5 truncate">{session.playerName}</p>
              </div>
            )}

            {needsSetup ? (
              allowSelfLink ? (
                /*
                 * v1.61.0 — open self-link CTA, available to any
                 * authenticated user (LINE / Google / email). The
                 * /assign-player route accepts the session regardless of
                 * provider when League.allowSelfLink === true.
                 */
                <Link
                  href="/assign-player"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-electric-green hover:bg-electric-green/5 transition-colors"
                  data-testid="account-menu-assign-player"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  {"Assign to my player"}
                </Link>
              ) : (
                /*
                 * v1.61.0 — self-link toggle OFF for this league. Surface
                 * the invite path with a mailto so the user has a path
                 * forward. Replaces the v1.39.2 LINE-only gate (now
                 * obsolete — the API accepts non-LINE sessions when
                 * allowSelfLink === true).
                 */
                <div
                  data-testid="account-menu-need-invite"
                  className="px-4 py-3 text-[12px] text-fg-mid leading-relaxed"
                >
                  <p>
                    {"Ask an admin or "}
                    <a
                      href="mailto:vitoriatamachi@gmail.com"
                      onClick={() => setOpen(false)}
                      className="text-electric-green hover:underline"
                    >
                      {"vitoriatamachi@gmail.com"}
                    </a>
                    {"."}
                  </p>
                </div>
              )
            ) : (
              <>
                {/* v1.37.0 (PR ι) — self-service "Change my details". */}
                <Link
                  href="/account/player"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-fg-high hover:text-fg-mid hover:bg-surface transition-colors"
                  data-testid="account-menu-edit-details"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  {"Edit my details"}
                </Link>
                {/*
                 * v1.67.0 — gate the Change/Unassign link on
                 * `allowSelfLink === true`. Pre-v1.67.0 the link routed
                 * to /assign-player which then surfaced a friendly
                 * SelfLinkDisabledSurface when the toggle was off; the
                 * user wants the link itself HIDDEN when off, not just
                 * the destination friendly. The route keeps its
                 * disabled-state surface for direct visitors (defensive).
                 */}
                {allowSelfLink && (
                  <Link
                    href="/assign-player"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-fg-high hover:text-fg-mid hover:bg-surface transition-colors"
                    data-testid="account-menu-change-player"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    {"Change/Unassign player"}
                  </Link>
                )}
              </>
            )}

            {/* v1.62.0 — the "Switch league" inline submenu is removed.
                The header chevron `LeagueSwitcher` stays as the only
                league switcher (rendered next to the brand title in
                Header.tsx). */}

            {session.isAdmin && (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-fg-high hover:text-fg-mid hover:bg-surface transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {"Admin"}
              </Link>
            )}

            <button
              onClick={() => signOut({ callbackUrl: getCurrentCallbackUrl() })}
              className="w-full flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-fg-high hover:text-fg-mid hover:bg-surface-md transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {"Sign out"}
            </button>

            {/* Dev Mode Switching (Local only) */}
            {process.env.NODE_ENV === 'development' && (
              <div className="border-t border-border-subtle px-3 py-3 bg-surface">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-fg-mid mb-2 px-1">{"Dev Shortcuts"}</p>
                <div className="grid grid-cols-1 gap-1">
                  {[
                    { id: 'ian-noseda', name: 'Ian Noseda', teamId: 'mariners-fc' },
                    { id: 'ivo-rodrigues', name: 'Ivo Rodrigues', teamId: 'fenix-fc' },
                    { id: 'ryohei-enomoto', name: 'Ryohei Enomoto', teamId: 'hygge-sc' },
                    { id: 'riki-imai', name: 'Riki Imai', teamId: 'fc-torpedo' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => signIn('dev-login', {
                        playerId: p.id,
                        playerName: p.name,
                        teamId: p.teamId,
                        callbackUrl: '/'
                      })}
                      className="text-left px-2 py-1.5 rounded-lg text-[10px] font-bold text-fg-mid hover:text-electric-green hover:bg-electric-green/5 transition-all truncate"
                    >
                      {"Impersonate:"} {p.name}
                    </button>
                  ))}
                  <button
                    onClick={() => signIn('dev-login', {
                      playerId: 'guest-dev',
                      playerName: 'Guest Dev',
                      teamId: '',
                      callbackUrl: '/assign-player'
                    })}
                    className="text-left px-2 py-1.5 rounded-lg text-[10px] font-bold text-fg-mid hover:text-primary hover:bg-primary/5 transition-all truncate"
                  >
                    {"Login as Guest (No Player)"}
                  </button>
                </div>
              </div>
            )}

            <div
              data-testid="user-menu-version"
              className="border-t border-border-subtle px-4 py-2 text-center text-fg-low text-[10px] uppercase tracking-[0.2em] font-mono"
            >
              v{APP_VERSION}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
