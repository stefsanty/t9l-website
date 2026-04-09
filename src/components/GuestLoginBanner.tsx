'use client';

import { useSession, signIn } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

const LOGIN_LIGHTBOX_DISMISSED_KEY = 't9l-login-lightbox-dismissed';

function LineIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596a.603.603 0 0 1-.199.031c-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595a.657.657 0 0 1 .194-.033c.195 0 .375.105.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
    </svg>
  );
}

export default function GuestLoginBanner() {
  const { data: session, status } = useSession();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (status === 'loading' || session) return;
    const dismissed = sessionStorage.getItem(LOGIN_LIGHTBOX_DISMISSED_KEY);
    if (!dismissed) setVisible(true);
  }, [status, session]);

  function dismiss() {
    sessionStorage.setItem(LOGIN_LIGHTBOX_DISMISSED_KEY, '1');
    setVisible(false);
  }

  if (!visible) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-5">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={dismiss}
      />

      {/* Card */}
      <div className="relative w-full max-w-sm mx-auto bg-card border border-border-default rounded-3xl overflow-hidden shadow-2xl animate-in">
        <div className="px-7 pt-5 pb-8">
          {/* Icon */}
          <div className="w-14 h-14 rounded-2xl bg-[#06C755]/10 border border-[#06C755]/20 flex items-center justify-center mb-5">
            <LineIcon className="w-7 h-7 text-[#06C755]" />
          </div>

          <h2 className="font-display text-3xl font-black uppercase tracking-tight text-fg-high leading-tight">
            {"Sign in to RSVP"}
          </h2>
          <p className="text-sm text-fg-mid mt-2 leading-relaxed">
            {"Login with LINE to confirm your attendance for upcoming matchdays and show your photo in the squad list."}
          </p>

          {/* CTA */}
          <button
            onClick={() => signIn('line')}
            className="flex items-center justify-center gap-2 w-full mt-6 py-4 rounded-2xl bg-[#06C755] text-white font-display text-lg font-black uppercase tracking-wider hover:bg-[#05b34c] active:scale-[0.98] transition-all shadow-[0_4px_16px_rgba(6,199,85,0.25)]"
          >
            <LineIcon className="w-5 h-5" />
            {"Login with LINE"}
          </button>

          {/* Dismiss */}
          <button
            onClick={dismiss}
            className="w-full mt-4 text-[13px] text-fg-mid hover:text-fg-high transition-colors py-2"
          >
            {"Not now"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
