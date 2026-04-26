'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const tabs = [
  { label: 'Schedule', segment: 'schedule' },
  { label: 'Teams',    segment: 'teams'    },
  { label: 'Players',  segment: 'players'  },
  { label: 'Stats',    segment: 'stats'    },
  { label: 'Settings', segment: 'settings' },
]

export default function TabNav({ leagueId }: { leagueId: string }) {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-0 -mb-px overflow-x-auto scrollbar-hide">
      {tabs.map(({ label, segment }) => {
        const href = `/admin/leagues/${leagueId}/${segment}`
        const active = pathname.startsWith(href)
        return (
          <Link
            key={segment}
            href={href}
            className={cn(
              'px-4 py-2.5 text-sm transition-colors no-underline border-b-2 -mb-px whitespace-nowrap shrink-0',
              active
                ? 'text-admin-text border-admin-green'
                : 'text-admin-text2 border-transparent hover:text-admin-text hover:border-admin-border2',
            )}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
