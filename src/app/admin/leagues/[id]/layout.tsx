import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { ArrowLeft } from 'lucide-react'
import { formatJstDayMonth } from '@/lib/jst'
import TabNav from './TabNav'

function toSlug(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

type Props = {
  params: Promise<{ id: string }>
  children: React.ReactNode
}

export default async function LeagueLayout({ params, children }: Props) {
  const { id } = await params

  const league = await prisma.league.findUnique({
    where: { id },
    include: {
      gameWeeks: {
        include: { matches: true },
        orderBy: { weekNumber: 'asc' },
      },
    },
  })

  if (!league) notFound()

  const completedCount = league.gameWeeks.filter(
    (gw) => gw.matches.length > 0 && gw.matches.every((m) => m.status === 'COMPLETED'),
  ).length

  const nextGW = league.gameWeeks.find(
    (gw) => gw.matches.length === 0 || !gw.matches.every((m) => m.status === 'COMPLETED'),
  )

  // v1.55.0 (PR 2 of admin-UI-compat-audit chain): use the configured
  // `League.subdomain` as the canonical slug; fall back to the
  // toSlug(name) heuristic when the column is null (legacy unconfigured
  // leagues — the UI link is best-effort).
  const slug = league.subdomain ?? toSlug(league.name)

  // All admin display goes through canonical JST helpers — see lib/jst.ts.
  const formatDate = formatJstDayMonth

  return (
    <div className="flex flex-col min-h-full">
      {/* League header */}
      <div className="border-b border-admin-border bg-admin-surface px-4 md:px-8 pt-4 md:pt-5 pb-0">
        {/* Back + breadcrumb */}
        <div className="mb-3">
          <Link
            href="/admin"
            className="inline-flex items-center gap-1.5 text-admin-text3 text-sm hover:text-admin-text2 transition-colors no-underline"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Dashboard
          </Link>
        </div>

        {/* Title row */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2 md:gap-0 mb-4">
          <div>
            <h1 className="font-condensed font-extrabold text-admin-text text-[26px] leading-tight">
              {league.name}
            </h1>
            <a
              href={`/id/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-admin-green text-xs no-underline hover:underline"
              data-testid="admin-league-shell-public-link"
            >
              /id/{slug}
            </a>
          </div>

          {/* Status line */}
          <div className="text-sm text-admin-text2 md:text-right">
            <span className="text-admin-green">Active</span>
            <span className="text-admin-text3 mx-1.5">·</span>
            <span>MD{completedCount} completed</span>
            {nextGW && (
              <>
                <span className="text-admin-text3 mx-1.5">·</span>
                <span>MD{nextGW.weekNumber} next {nextGW.startDate ? formatDate(nextGW.startDate) : 'TBD'}</span>
              </>
            )}
          </div>
        </div>

        {/* Tab nav */}
        <TabNav leagueId={id} />
      </div>

      {/* Page content */}
      <div className="flex-1 p-4 md:p-8">
        {children}
      </div>
    </div>
  )
}
