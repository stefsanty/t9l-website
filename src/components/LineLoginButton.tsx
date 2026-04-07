'use client';

import { useSession, signIn, signOut } from 'next-auth/react';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import { useT } from '@/i18n/I18nProvider';

const GUEST_DISMISSED_KEY = 't9l-guest-dismissed';

function LineIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596a.603.603 0 0 1-.199.031c-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595a.657.657 0 0 1 .194-.033c.195 0 .375.105.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
    </svg>
  );
}

function AssignModal({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useT();
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-5">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onDismiss}
      />

      {/* Card */}
      <div className="relative w-full max-w-sm mx-auto bg-deep-purple border border-white/15 rounded-3xl overflow-hidden shadow-2xl animate-in">

        <div className="px-7 pt-5 pb-8">
          {/* Icon */}
          <div className="w-14 h-14 rounded-2xl bg-[#06C755]/10 border border-[#06C755]/20 flex items-center justify-center mb-5">
            <LineIcon className="w-7 h-7 text-[#06C755]" />
          </div>

          <h2 className="font-display text-3xl font-black uppercase tracking-tight text-white leading-tight">
            {t('loggedInTitle')}
          </h2>
          <p className="text-sm text-white/80 mt-2 leading-relaxed">
            {t('loggedInDesc')}
          </p>

          {/* CTA */}
          <Link
            href="/assign-player"
            className="flex items-center justify-center gap-2 w-full mt-6 py-4 rounded-2xl bg-electric-green text-black font-display text-lg font-black uppercase tracking-wider hover:bg-electric-green/90 active:scale-[0.98] transition-all"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {t('assignToPlayer')}
          </Link>

          {/* Guest link */}
          <button
            onClick={onDismiss}
            className="w-full mt-4 text-[13px] text-white/80 hover:text-white/95 transition-colors py-2"
          >
            {t('continueAsGuest')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LineLoginButton() {
  const { t } = useT();
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Show the assign modal on first login (no player assigned, not previously dismissed)
  useEffect(() => {
    if (status === 'authenticated' && !session?.playerId) {
      const dismissed = localStorage.getItem(GUEST_DISMISSED_KEY);
      if (!dismissed) {
        setShowAssignModal(true);
      }
    }
  }, [status, session?.playerId]);

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
    return <div className="w-8 h-8 rounded-full bg-white/10 animate-pulse" />;
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
          {t('login')} {process.env.NODE_ENV === 'development' && (
            <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>

        {open && process.env.NODE_ENV === 'development' && (
          <div className="absolute right-0 top-full mt-2 w-52 bg-deep-purple border border-white/15 rounded-2xl overflow-hidden z-50 shadow-2xl">
            <button
              onClick={() => signIn('line')}
              className="w-full flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-white/95 hover:text-white/80 hover:bg-white/5 transition-colors border-b border-white/10"
            >
              <LineIcon className="w-4 h-4 text-[#06C755]" />
              {t('loginViaLine')}
            </button>

            <div className="px-3 py-3 bg-white/[0.02]">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/65 mb-2 px-1">{t('devShortcuts')}</p>
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
                    className="text-left px-2 py-1.5 rounded-lg text-[10px] font-bold text-white/80 hover:text-electric-green hover:bg-electric-green/5 transition-all truncate"
                  >
                    {t('impersonate')} {p.name}
                  </button>
                ))}
                <button
                  onClick={() => signIn('dev-login', {
                    playerId: 'guest-dev',
                    playerName: 'Guest Dev',
                    teamId: '',
                    callbackUrl: '/assign-player'
                  })}
                  className="text-left px-2 py-1.5 rounded-lg text-[10px] font-bold text-white/80 hover:text-vibrant-pink hover:bg-vibrant-pink/5 transition-all truncate"
                >
                  {t('loginAsGuestNoPlayer')}
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
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-vibrant-pink rounded-full border-2 border-midnight" />
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-52 bg-deep-purple border border-white/15 rounded-2xl overflow-hidden z-50 shadow-2xl">
            {needsSetup ? (
              <div className="px-4 py-3 border-b border-white/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/80">{t('signedInAsGuest')}</p>
                <p className="text-xs text-white/95 mt-0.5">{t('noPlayerAssigned')}</p>
              </div>
            ) : (
              <div className="px-4 py-3 border-b border-white/10">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/80">{t('playingAs')}</p>
                <p className="text-sm font-black text-white mt-0.5 truncate">{session.playerName}</p>
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
                {t('assignToPlayer')}
              </Link>
            ) : (
              <Link
                href="/assign-player"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-white/95 hover:text-white/80 hover:bg-white/5 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {t('changeUnassignPlayer')}
              </Link>
            )}

            <button
              onClick={() => { setOpen(false); signOut(); }}
              className="w-full flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-white/95 hover:text-white/70 hover:bg-white/10 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {t('signOut')}
            </button>

            {/* Dev Mode Switching (Local only) */}
            {process.env.NODE_ENV === 'development' && (
              <div className="border-t border-white/10 px-3 py-3 bg-white/[0.02]">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/65 mb-2 px-1">{t('devShortcuts')}</p>
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
                      className="text-left px-2 py-1.5 rounded-lg text-[10px] font-bold text-white/80 hover:text-electric-green hover:bg-electric-green/5 transition-all truncate"
                    >
                      {t('impersonate')} {p.name}
                    </button>
                  ))}
                  <button
                    onClick={() => signIn('dev-login', {
                      playerId: 'guest-dev',
                      playerName: 'Guest Dev',
                      teamId: '',
                      callbackUrl: '/assign-player'
                    })}
                    className="text-left px-2 py-1.5 rounded-lg text-[10px] font-bold text-white/80 hover:text-vibrant-pink hover:bg-vibrant-pink/5 transition-all truncate"
                  >
                    {t('loginAsGuestNoPlayer')}
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
