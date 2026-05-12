/**
 * v2.1.0 — small reusable spinning loader. The v1.99.0 streaming
 * skeleton relied purely on `animate-pulse` rectangles; user feedback
 * was that the wait felt like a frozen screen because pulse-only
 * animations are easy to miss. This component adds an unmistakeable
 * rotating-arc loader that pairs with the skeleton inside each
 * per-section Suspense fallback.
 *
 * SVG with a partial-stroke conic so the rotation is visible without
 * relying on opacity changes. Pure server component (no client JS) —
 * the animation runs entirely from the `animate-spin` keyframe.
 *
 * `size` controls the box (sm = 16 px, md = 24 px, lg = 36 px).
 * `tone` switches the stroke color: 'subtle' for inline-on-skeleton,
 * 'bold' for high-contrast on top of bg-card.
 */
export default function LoadingSpinner({
  size = 'md',
  tone = 'subtle',
  className = '',
  ariaLabel = 'Loading',
}: {
  size?: 'sm' | 'md' | 'lg'
  tone?: 'subtle' | 'bold'
  className?: string
  ariaLabel?: string
}) {
  const dim =
    size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-9 w-9' : 'h-6 w-6'
  const stroke =
    tone === 'bold' ? 'text-fg-high' : 'text-fg-mid'
  return (
    <svg
      data-testid="loading-spinner"
      role="status"
      aria-label={ariaLabel}
      className={`animate-spin ${dim} ${stroke} ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="3"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
