'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

const ADMIN_LINE_ID = 'Uc8cdcc63cac89d5c349aa72b9e3355c2';

const QUICK_PICKS = [
  { label: 'Admin', lineId: ADMIN_LINE_ID },
  { label: 'Unassigned user', lineId: 'test-unassigned-user' },
];

export default function DevLoginClient() {
  const [lineId, setLineId] = useState(ADMIN_LINE_ID);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    const id = lineId.trim();
    if (!id) return;
    setLoading(true);
    await signIn('line-mock', { lineId: id, callbackUrl: '/' });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="mb-5 px-4 py-2.5 rounded-2xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-[10px] font-black uppercase tracking-[0.15em] text-center">
          Dev Mode — Not available in production
        </div>

        <div className="bg-card border border-border-default rounded-3xl overflow-hidden shadow-2xl">
          <div className="px-7 pt-6 pb-8">
            <h1 className="font-display text-3xl font-black uppercase tracking-tight text-fg-high leading-tight mb-1">
              Dev Login
            </h1>
            <p className="text-sm text-fg-mid mb-6">
              Log in as any LINE ID without OAuth. Player mapping and admin status are resolved from Redis as normal.
            </p>

            <div className="mb-4">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-fg-mid mb-2">Quick picks</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_PICKS.map((p) => (
                  <button
                    key={p.lineId}
                    onClick={() => setLineId(p.lineId)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                      lineId === p.lineId
                        ? 'bg-electric-green/10 border-electric-green/40 text-electric-green'
                        : 'border-border-subtle text-fg-mid hover:border-electric-green/30 hover:text-fg-high'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-[9px] font-black uppercase tracking-[0.2em] text-fg-mid mb-2">
                LINE ID
              </label>
              <input
                type="text"
                value={lineId}
                onChange={(e) => setLineId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                className="w-full px-4 py-3 rounded-xl bg-surface border border-border-default text-fg-high text-sm font-mono focus:outline-none focus:border-electric-green/50 transition-colors"
                placeholder="Uc8cdcc63cac89d5c..."
                autoFocus
              />
            </div>

            <button
              onClick={handleLogin}
              disabled={loading || !lineId.trim()}
              className="w-full py-4 rounded-2xl bg-electric-green text-black font-display text-lg font-black uppercase tracking-wider hover:bg-electric-green/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Logging in…' : 'Login as this LINE ID'}
            </button>

            <Link
              href="/"
              className="block w-full mt-4 text-[12px] text-fg-mid hover:text-fg-high transition-colors text-center py-2"
            >
              Back to site
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
