'use client';

import { useSession, signIn, signOut } from 'next-auth/react';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';

const GUEST_DISMISSED_KEY = 't9l-guest-dismissed';
const INSTALL_DISMISSED_KEY = 't9l-install-dismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

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

function InstallBanner({
  isIOS,
  deferredPrompt,
  onDismiss,
}: {
  isIOS: boolean;
  deferredPrompt: BeforeInstallPromptEvent | null;
  onDismiss: (dontShowAgain: boolean) => void;
}) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  async function handleInstall() {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        onDismiss(true);
        return;
      }
    }
    onDismiss(dontShowAgain);
  }

  return (
    <div className="fixed top-0 inset-x-0 z-[200] flex justify-center px-3 pt-3 sm:hidden">
      <div className="w-full max-w-sm bg-card border border-border-default rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-4 pt-4 pb-3">
          {/* Header row */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-electric-green/10 border border-electric-green/20 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-electric-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display text-sm font-black uppercase tracking-tight text-fg-high leading-none">{"Add to Home Screen"}</p>
              <p className="text-[11px] text-fg-mid mt-0.5 leading-tight">{"Install T9L for quick access — no browser needed."}</p>
            </div>
            <button
              onClick={() => onDismiss(dontShowAgain)}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-fg-mid hover:text-fg-high hover:bg-surface transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* iOS instructions or install button */}
          {isIOS ? (
            <p className="text-[11px] text-fg-mid mt-3 leading-relaxed">
              {"Tap "}
              <span className="font-bold text-fg-high">{"Share ⎙"}</span>
              {" at the bottom of Safari, then "}
              <span className="font-bold text-fg-high">{"Add to Home Screen"}</span>
              {"."}
            </p>
          ) : (
            <button
              onClick={handleInstall}
              className="flex items-center justify-center gap-1.5 w-full mt-3 py-2.5 rounded-xl bg-electric-green text-black font-display text-[13px] font-black uppercase tracking-wider hover:bg-electric-green/90 active:scale-[0.98] transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {"Install App"}
            </button>
          )}

          {/* Don't show again */}
          <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-electric-green"
            />
            <span className="text-[11px] text-fg-mid">{"Don't show this again"}</span>
          </label>
        </div>
      </div>
    </div>
  );
}

export default function LineLoginButton() {
    const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Detect platform and capture install prompt
  useEffect(() => {
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches);
    setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent));

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Show the assign modal on first login (no player assigned, not previously dismissed)
  useEffect(() => {
    if (status === 'authenticated' && !session?.playerId) {
      const dismissed = localStorage.getItem(GUEST_DISMISSED_KEY);
      if (!dismissed) {
        setShowAssignModal(true);
      }
    }
  }, [status, session?.playerId]);

  // Show install modal for authenticated users who haven't dismissed it
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (isStandalone) return;
    if (localStorage.getItem(INSTALL_DISMISSED_KEY)) return;
    if (deferredPrompt || isIOS) {
      setShowInstallModal(true);
    }
  }, [status, deferredPrompt, isIOS, isStandalone]);

  function handleInstallDismiss(dontShowAgain: boolean) {
    if (dontShowAgain) localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
    setShowInstallModal(false);
    setDeferredPrompt(null);
  }

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
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => {
            if (process.env.NODE_ENV === 'development') {
              setOpen(!open);
            } else {
              signIn('line');
            }
          }}
          className="flex items-center gap-1.5 bg-[#06C755] hover:bg-[#05b34c] active:scale-95 text-white text-[11px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full transition-all"
        >
          <LineIcon className="w-3.5 h-3.5" />
          {"Login"} {process.env.NODE_ENV === 'development' && (
            <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>

        {open && process.env.NODE_ENV === 'development' && (
          <div className="absolute right-0 top-full mt-2 w-52 bg-card border border-border-default rounded-2xl overflow-hidden z-50 shadow-2xl">
            <button
              onClick={() => signIn('line')}
              className="w-full flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-fg-high hover:text-fg-mid hover:bg-surface transition-colors border-b border-border-subtle"
            >
              <LineIcon className="w-4 h-4 text-[#06C755]" />
              {"Login via LINE"}
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
    );
  }

  const needsSetup = !session.playerId;

  return (
    <>
      {/* First-login lightbox — rendered via portal to escape header's transform stacking context */}
      {showAssignModal && createPortal(
        <AssignModal onDismiss={handleVisitAsGuest} />,
        document.body,
      )}

      {/* Install app banner (top of screen, no backdrop) */}
      {showInstallModal && !showAssignModal && createPortal(
        <InstallBanner
          isIOS={isIOS}
          deferredPrompt={deferredPrompt}
          onDismiss={handleInstallDismiss}
        />,
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
                <p className="text-xs text-fg-high mt-0.5">{"No player assigned yet"}</p>
              </div>
            ) : (
              <div className="px-4 py-3 border-b border-border-subtle">
                <p className="text-[10px] font-black uppercase tracking-widest text-fg-mid">{"Playing as"}</p>
                <p className="text-sm font-black text-fg-high mt-0.5 truncate">{session.playerName}</p>
              </div>
            )}

            {needsSetup ? (
              <Link
                href="/assign-player"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-electric-green hover:bg-electric-green/5 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {"Assign to my player"}
              </Link>
            ) : (
              <Link
                href="/assign-player"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-fg-high hover:text-fg-mid hover:bg-surface transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {"Change/Unassign player"}
              </Link>
            )}

            {!isStandalone && (deferredPrompt || isIOS) && (
              <button
                onClick={() => { setOpen(false); setShowInstallModal(true); }}
                className="w-full flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-fg-high hover:text-fg-mid hover:bg-surface transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                {"Add to Home Screen"}
              </button>
            )}

            <button
              onClick={() => { setOpen(false); signOut(); }}
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
          </div>
        )}
      </div>
    </>
  );
}
