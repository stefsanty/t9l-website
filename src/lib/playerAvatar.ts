/**
 * v1.37.0 (PR ι) — pure render-priority helper for player avatar URLs.
 *
 * Priority order:
 *   1. profilePictureUrl — user-uploaded via /account/player
 *   2. pictureUrl        — LINE-CDN mirror (PR 12 / v1.3.1)
 *   3. null              — caller falls through to PlayerAvatar's
 *                          static-fallback chain (slug → default).
 *
 * Lives outside the React component tree so it can be reused on the
 * server (admin pages, public dashboard render) without crossing the
 * client boundary. The component-level fallback chain in
 * `PlayerAvatar.tsx` still kicks in when this returns null.
 *
 * Why a helper instead of inlining `profilePictureUrl ?? pictureUrl`:
 * the priority might grow (e.g. v1.38 adds a `groupBookingPictureUrl`)
 * and one named function is easier to grep for than scattered `??`
 * chains.
 */
export function pickPlayerAvatarUrl(input: {
  profilePictureUrl?: string | null
  pictureUrl?: string | null
}): string | null {
  return input.profilePictureUrl ?? input.pictureUrl ?? null
}
