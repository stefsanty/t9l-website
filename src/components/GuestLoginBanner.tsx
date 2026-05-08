'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { getCurrentCallbackUrl } from '@/lib/signInCallbackUrl';

// v1.80.8 — perf phase 4c: lazy-load the modal so its chunk only fetches
// when the user clicks the banner's Sign in CTA.
const SignInLightbox = dynamic(() => import('./SignInLightbox'), {
  loading: () => null,
});

export default function GuestLoginBanner() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  // v1.70.3 — capture the current page path at click time so the OAuth
  // round-trip returns the user to the league subpage they triggered
  // sign-in from (pre-v1.70.3 callbackUrl defaulted to '/' and dropped
  // /id/<slug> context).
  const [callbackUrl, setCallbackUrl] = useState('/');

  if (status === 'loading' || session) return null;

  function openLightbox() {
    setCallbackUrl(getCurrentCallbackUrl());
    setOpen(true);
  }

  return (
    <>
      <div className="mb-4 bg-[#06C755]/10 border border-[#06C755]/20 rounded-2xl overflow-hidden relative group">
        <div className="absolute inset-0 bg-diagonal-pattern opacity-[0.03] pointer-events-none" />
        <div className="px-5 py-4 relative flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-black uppercase tracking-tight text-fg-high leading-none mb-1">
              RSVP to your matchdays
            </h3>
            <p className="text-[11px] font-bold text-fg-mid leading-tight">
              Sign in to confirm attendance.
            </p>
          </div>
          <button
            onClick={openLightbox}
            className="shrink-0 bg-[#06C755] hover:bg-[#05b34c] active:scale-95 text-white text-[12px] font-black uppercase tracking-wider px-5 py-2 rounded-xl transition-all shadow-[0_4px_12px_rgba(6,199,85,0.2)]"
            data-testid="guest-banner-signin"
          >
            Sign in
          </button>
        </div>
      </div>
      {open && <SignInLightbox open onClose={() => setOpen(false)} callbackUrl={callbackUrl} />}
    </>
  );
}
