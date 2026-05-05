'use client'

/**
 * v1.63.0 — Recruiting banner.
 *
 * Surfaces a prominent "RECRUITING NOW" CTA at the top of the public
 * homepage when `League.recruiting === true`. Visual treatment is
 * eye-catching by design — vibrant-pink accent gradient + black text
 * + diagonal pattern — so it stands out above the rest of the
 * homepage chrome.
 *
 * Click target is currently a no-op TODO (the banner reads as a
 * placeholder for the future per-league recruiting destination, e.g.
 * a Google form, an admin-defined URL, or an in-app onboarding flow).
 * The `data-testid="recruiting-cta-todo"` hook lets us regression-pin
 * the placeholder so a future PR wiring a real target removes the
 * TODO surface intentionally rather than by accident.
 */

export default function RecruitingBanner() {
  return (
    <button
      type="button"
      data-testid="recruiting-cta-todo"
      onClick={() => {
        // TODO(v1.64.0+): wire to per-league recruiting target — admin-
        // configurable URL, or an in-app sign-up flow. For now the
        // banner is a visual surface only; no destination.
      }}
      className="w-full mt-2 mb-3 rounded-2xl border border-vibrant-pink/60 bg-gradient-to-r from-vibrant-pink to-orange-500 px-4 py-3 text-left relative overflow-hidden hover:opacity-95 transition-opacity active:scale-[0.99]"
    >
      <div className="absolute inset-0 bg-diagonal-pattern opacity-10 pointer-events-none" />
      <div className="relative flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-2xl font-black uppercase tracking-tight text-white leading-none">
            Recruiting Now
          </p>
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/90 mt-1">
            Looking for new players — tap to learn more
          </p>
        </div>
        <span aria-hidden className="text-2xl text-white/90 shrink-0">
          →
        </span>
      </div>
    </button>
  )
}
