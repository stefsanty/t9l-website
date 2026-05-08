'use client'

import dynamic from 'next/dynamic'

/**
 * v1.80.9 — phase 4d perf: lazy-load sonner's <Toaster />.
 *
 * Pre-v1.80.9, `import { Toaster } from "sonner"` in `app/layout.tsx`
 * pulled the entire sonner bundle (~36 KB parsed / ~10 KB gz) into
 * the public root chunk on every page first-load — even though the
 * Toaster only renders DOM after a user-triggered `toast(...)` call.
 *
 * `next/dynamic` with `ssr: false` defers the sonner import until the
 * client mounts. The wrapper renders nothing during SSR (matching the
 * SSR output of <Toaster /> itself, which is also empty until a toast
 * fires) so there's no hydration mismatch. Same pattern as the v1.80.8
 * SignInLightbox / ApplyToLeagueModal lazy-load.
 *
 * Pages that call `toast(...)` directly (CopyMatchdayLink,
 * AssignPlayerClient) still pull sonner — but in their per-route
 * chunk, not the shared root layer.
 */
const Toaster = dynamic(
  () => import('sonner').then((m) => ({ default: m.Toaster })),
  { ssr: false },
)

export default function ToasterMount() {
  return (
    <Toaster
      position="top-center"
      duration={4500}
      theme="dark"
      toastOptions={{
        className: 'font-display uppercase tracking-wider text-xs',
      }}
    />
  )
}
