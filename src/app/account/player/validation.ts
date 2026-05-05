/**
 * v1.59.2 — pure validation constants for /account/player.
 *
 * Pre-v1.59.2 these constants lived in `actions.ts` (a `'use server'`
 * file). Next.js 16 converts EVERY export from a `'use server'` file
 * into a server-action proxy on the client side — the actual values
 * never reach the browser. So `AccountPlayerForm` (a client component)
 * imported `PROFILE_PIC_ALLOWED_TYPES` thinking it was the array
 * `['image/jpeg', 'image/png', 'image/webp']`, but at runtime it was
 * a function (server reference). Calling `.join(',')` on it during
 * render threw `PROFILE_PIC_ALLOWED_TYPES.join is not a function`,
 * which crashed hydration — the user saw Next.js's default global
 * error UI ("This page couldn't load. Reload to try again, or go back.").
 *
 * The bug pre-dated v1.59.1; it was hidden because v1.37.0–v1.59.0 had
 * a broken admin-shell gate that returned a "can't edit here" message
 * for many sessions before the form ever rendered. v1.59.1 fixed the
 * gate, more users reached the form, hydration started crashing.
 *
 * Fix: move the constants here, where there's no `'use server'`
 * directive, so client imports see the real values.
 *
 * **Standing rule:** never `export const` (or any non-async value)
 * from a file with `'use server'` at the top. Server-action files are
 * for async functions only. Constants, types, and interfaces shared
 * between server actions and client components live in a separate
 * neutral module like this one.
 */

export const PROFILE_PIC_MAX_BYTES = 5 * 1024 * 1024
export const PROFILE_PIC_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const
