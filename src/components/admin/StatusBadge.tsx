import { cn } from '@/lib/utils'

type Status = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'POSTPONED' | 'ACTIVE' | 'UPCOMING'

const config: Record<Status, { label: string; classes: string }> = {
  SCHEDULED:   { label: 'Scheduled',   classes: 'bg-admin-surface3 text-admin-text2 border border-admin-border' },
  IN_PROGRESS: { label: 'In Progress', classes: 'bg-admin-amber-dim text-admin-amber border border-admin-amber/30' },
  COMPLETED:   { label: 'Completed',   classes: 'bg-admin-green-dim text-admin-green border border-admin-green/30' },
  CANCELLED:   { label: 'Cancelled',   classes: 'bg-admin-red-dim text-admin-red border border-admin-red/30' },
  POSTPONED:   { label: 'Postponed',   classes: 'bg-admin-surface3 text-admin-text3 border border-admin-border' },
  ACTIVE:      { label: 'Active',      classes: 'bg-admin-green-dim text-admin-green border border-admin-green/30' },
  UPCOMING:    { label: 'Upcoming',    classes: 'bg-admin-surface3 text-admin-text2 border border-admin-border' },
}

interface StatusBadgeProps {
  status: Status
  className?: string
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const { label, classes } = config[status] ?? config.SCHEDULED
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium', classes, className)}>
      {label}
    </span>
  )
}
