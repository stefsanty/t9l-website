'use client'

import { useState } from 'react'
import { pickPlayerAvatarUrl } from '@/lib/playerAvatar'

/**
 * v1.38.0 (PR κ) — round avatar for the admin player list.
 *
 * Source priority:
 *   1. profilePictureUrl — user-uploaded via /account/player (PR ι)
 *   2. pictureUrl        — LINE-CDN mirror written by /api/assign-player
 *   3. linePictureUrl    — current LineLogin.pictureUrl (admin-data join)
 *   4. initials fallback (first letter of name on neutral background)
 *
 * The first three are static URL strings — `<img>` (not `next/image`)
 * because LINE / Vercel-Blob hostnames aren't whitelisted in
 * next.config and we don't want a hostname-allow miss to crash the
 * row. `onError` falls through to the initials block.
 *
 * Default size: 36px. Caller can pass `size={40}` etc. — the component
 * is sized via inline style so it composes inside grids without
 * affecting outer layout.
 */
export interface AdminPlayerAvatarProps {
  name: string | null
  profilePictureUrl?: string | null
  pictureUrl?: string | null
  linePictureUrl?: string | null
  size?: number
  testid?: string
}

function avatarInitial(name: string | null): string {
  return (name?.trim()?.[0] ?? '?').toUpperCase()
}

export default function AdminPlayerAvatar({
  name,
  profilePictureUrl,
  pictureUrl,
  linePictureUrl,
  size = 36,
  testid,
}: AdminPlayerAvatarProps) {
  const [errored, setErrored] = useState(false)
  const url =
    pickPlayerAvatarUrl({
      profilePictureUrl,
      pictureUrl,
    }) ?? linePictureUrl ?? null

  if (!url || errored) {
    return (
      <div
        className="shrink-0 rounded-full bg-admin-surface3 border border-admin-border flex items-center justify-center text-admin-text2 font-bold"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
        data-testid={testid ?? 'admin-player-avatar-fallback'}
      >
        {avatarInitial(name)}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name ?? 'Player avatar'}
      onError={() => setErrored(true)}
      className="shrink-0 rounded-full bg-admin-surface3 border border-admin-border object-cover"
      style={{ width: size, height: size }}
      data-testid={testid ?? 'admin-player-avatar-img'}
    />
  )
}
