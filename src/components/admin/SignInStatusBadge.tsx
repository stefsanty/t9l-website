import { cn } from '@/lib/utils'
import {
  SIGN_IN_STATUS_LABEL,
  type PlayerSignInStatus,
} from '@/lib/playerSignInStatus'

/**
 * v1.38.0 (PR κ) — colored pill rendering the player's sign-in state.
 *
 * Three states (see `lib/playerSignInStatus.ts`):
 *   - signed_up → green dot — bound user, completed
 *   - invited   → yellow dot — invite generated, awaiting redemption
 *   - pending   → gray dot   — no invite, no user (e.g. legacy roster slot)
 *
 * Render shape mirrors the existing `StatusBadge` component (small dot
 * + label) so the visual grammar of the admin shell stays consistent.
 * Border deliberately omitted — badges communicate state, not
 * affordance (per the v1.21.0 schedule-tab taxonomy convention).
 */

interface SignInStatusBadgeProps {
  status: PlayerSignInStatus
  testid?: string
}

const STATUS_TONE: Record<PlayerSignInStatus, { dot: string; text: string }> = {
  signed_up: { dot: 'bg-admin-green', text: 'text-admin-green' },
  invited:   { dot: 'bg-admin-amber', text: 'text-admin-amber' },
  pending:   { dot: 'bg-admin-text3', text: 'text-admin-text3' },
}

export default function SignInStatusBadge({ status, testid }: SignInStatusBadgeProps) {
  const tone = STATUS_TONE[status]
  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-testid={testid ?? `signin-status-${status}`}
      data-signin-status={status}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', tone.dot)} aria-hidden />
      <span className={cn('text-[11px] uppercase tracking-wider font-bold', tone.text)}>
        {SIGN_IN_STATUS_LABEL[status]}
      </span>
    </span>
  )
}
