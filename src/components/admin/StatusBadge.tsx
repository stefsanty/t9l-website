import { cn } from '@/lib/utils'

/**
 * v1.21.0 — Status badges for matchdays and matches.
 *
 * The pre-v1.21.0 taxonomy had `SCHEDULED` / `UPCOMING` / `IN_PROGRESS`
 * collide visually for the matchday level — admins couldn't tell at a
 * glance whether a matchday had zero matches or just no live ones. The
 * v1.21.0 surface uses cleaner labels:
 *
 *   - **Empty** (matchday has no matches scheduled yet)
 *   - **Pending** (matches scheduled but none played)
 *   - **Live** (one or more matches currently in progress)
 *   - **Done** (all matches completed)
 *   - **Cancelled** / **Postponed** (per-match flags from updateMatch)
 *
 * Tinted backgrounds, NO border per the v1.21.0 visual taxonomy — badges
 * are status indicators, not interactive surfaces.
 */

type Status =
  | 'EMPTY'
  | 'PENDING'
  | 'LIVE'
  | 'DONE'
  // Per-match terminal states surfaced via the kebab.
  | 'CANCELLED'
  | 'POSTPONED'
  // Player-tab statuses (kept for the existing PlayersTab callers).
  | 'ACTIVE'
  | 'SCHEDULED'
  // Match-row "scheduled-not-yet-played" state (from raw match.status).
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'UPCOMING'

const config: Record<Status, { label: string; classes: string }> = {
  // v1.21.0 taxonomy — matchday-level.
  EMPTY:       { label: 'Empty',       classes: 'bg-admin-surface3 text-admin-text3' },
  PENDING:     { label: 'Pending',     classes: 'bg-admin-amber-dim text-admin-amber' },
  LIVE:        { label: 'Live',        classes: 'bg-admin-green-dim text-admin-green' },
  DONE:        { label: 'Done',        classes: 'bg-admin-surface3 text-admin-text3' },
  CANCELLED:   { label: 'Cancelled',   classes: 'bg-admin-red-dim text-admin-red' },
  POSTPONED:   { label: 'Postponed',   classes: 'bg-admin-surface3 text-admin-text3' },
  // Legacy / players-tab labels.
  ACTIVE:      { label: 'Active',      classes: 'bg-admin-green-dim text-admin-green' },
  SCHEDULED:   { label: 'Scheduled',   classes: 'bg-admin-surface3 text-admin-text2' },
  IN_PROGRESS: { label: 'In Progress', classes: 'bg-admin-amber-dim text-admin-amber' },
  COMPLETED:   { label: 'Completed',   classes: 'bg-admin-surface3 text-admin-text3' },
  UPCOMING:    { label: 'Upcoming',    classes: 'bg-admin-amber-dim text-admin-amber' },
}

interface StatusBadgeProps {
  status: Status
  className?: string
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const { label, classes } = config[status] ?? config.PENDING
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium', classes, className)}>
      {label}
    </span>
  )
}
