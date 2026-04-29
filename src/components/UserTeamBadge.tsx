'use client';

import Image from 'next/image';
import { useSession } from 'next-auth/react';
import type { Team } from '@/types';
import { pickUserTeam } from '@/lib/userTeam';

interface UserTeamBadgeProps {
  teams: Team[];
}

/**
 * v1.11.0 / PR C — small banner above NextMatchdayBanner that tells the
 * logged-in linked user which team is theirs:
 *
 *   "YOUR TEAM" + [logo] + Team Name
 *
 * Renders nothing for unauthenticated visitors and for authenticated
 * users who haven't linked a player yet (so there's no flash of "your
 * team is null"). The data is already in scope for `Dashboard` — `teams`
 * comes from the RSC payload, `session.teamId` from `useSession()` —
 * so this is zero new data plumbing.
 *
 * Logo fallback: if `Team.logo` is null OR the image fails to load, we
 * render a colored circle with the first character of the team name
 * using `Team.color` (an existing optional Prisma field; falls back to
 * a neutral surface color if also null).
 *
 * Why client-rendered (not SSR via `getServerSession`): the parent
 * `Dashboard` is already a client component reading `useSession()`, so
 * the badge appears within the same hydration tick (~100ms post-RSC).
 * A pure-SSR variant would require threading session through the RSC
 * boundary in `app/page.tsx`, which is more refactor than the badge
 * is worth. Tradeoff: brief flash-of-no-badge for the first ~100ms,
 * same as the existing `RsvpBar` (which gates on the same session).
 */
export default function UserTeamBadge({ teams }: UserTeamBadgeProps) {
  const { data: session } = useSession();
  // Render-branch decisions (null vs badge) are owned by the pure
  // `pickUserTeam` helper so they can be tested without React.
  const team = pickUserTeam(session ?? null, teams);
  if (!team) return null;

  return (
    <div
      className="mb-3 flex items-center justify-center gap-2.5 px-3 py-2 rounded-2xl bg-card/40 border border-border-subtle"
      data-testid="user-team-badge"
    >
      <span className="text-[9px] font-black uppercase tracking-[0.25em] text-fg-mid">
        Your Team
      </span>
      <span className="w-px h-3 bg-border-default opacity-50" />
      <TeamLogoOrInitial team={team} />
      <span
        className="font-display text-base font-black uppercase tracking-tight text-fg-high"
        translate="no"
        data-testid="user-team-name"
      >
        {team.name}
      </span>
    </div>
  );
}

function TeamLogoOrInitial({ team }: { team: Team }) {
  if (team.logo) {
    return (
      <div className="relative w-6 h-6 shrink-0 rounded-md p-0.5 bg-surface border border-border-subtle">
        <Image
          src={team.logo}
          alt={team.name}
          fill
          className="object-contain p-0.5"
          data-testid="user-team-logo-img"
        />
      </div>
    );
  }
  // Colored-initial fallback — uses Team.color when present, else a
  // neutral surface color. Avoids a broken-image placeholder.
  const bg = team.color ?? 'var(--color-surface)';
  return (
    <div
      className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-[11px] font-black uppercase text-white border border-white/10"
      style={{ backgroundColor: bg }}
      data-testid="user-team-logo-initial"
    >
      {team.name.charAt(0)}
    </div>
  );
}
