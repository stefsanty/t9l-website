'use client'

import Link from 'next/link'
import { Settings } from 'lucide-react'

// Used inside the admin league-list rows. The outer wrapper is also a Link, so
// this inner Link needs to swallow click propagation to avoid double-navigation.
// Event handlers can't cross the Server→Client Component boundary, so the
// onClick lives in this dedicated client component.
export default function LeagueRowSettingsLink({ leagueId }: { leagueId: string }) {
  return (
    <Link
      href={`/admin/leagues/${leagueId}/settings`}
      onClick={(e) => e.stopPropagation()}
      className="p-1.5 rounded-lg text-admin-text3 hover:text-admin-text hover:bg-admin-surface2 transition-colors no-underline"
      title="Settings"
    >
      <Settings className="w-4 h-4" />
    </Link>
  )
}
