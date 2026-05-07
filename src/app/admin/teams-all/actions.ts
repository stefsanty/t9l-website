'use server'

/**
 * v1.74.0 — Server actions for the redesigned `/admin/teams-all` route.
 *
 * Replaces the legacy "All Teams" surface (which 404'd because the route
 * was never built). New surface is a global CRUD list across all leagues
 * with per-team logo upload via Vercel Blob client-direct upload (the
 * v1.71.1 pattern — bypass the 4.5MB Vercel platform body cap).
 *
 * Each action gates on `assertAdmin`. League at create time is required
 * and FIXED — moving a team between leagues is deferred (the natural
 * way to "move" a team is to enroll it in a new league via the per-
 * league Teams tab and remove it from the old one). `Team` rows are
 * global identities; `LeagueTeam` is the join.
 */

import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { revalidate } from '@/lib/revalidate'

async function assertAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.isAdmin) throw new Error('Unauthorized')
}

export interface CreateTeamInput {
  name: string
  leagueId: string
  logoUrl?: string | null
}

export async function adminCreateTeam(input: CreateTeamInput) {
  await assertAdmin()
  const name = input.name.trim()
  if (!name) throw new Error('Team name required')
  if (!input.leagueId) throw new Error('League required')

  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { id: true },
  })
  if (!league) throw new Error('League not found')

  const team = await prisma.$transaction(async (tx) => {
    const created = await tx.team.create({
      data: {
        name,
        logoUrl: input.logoUrl?.trim() || null,
      },
    })
    await tx.leagueTeam.create({
      data: { leagueId: input.leagueId, teamId: created.id },
    })
    return created
  })

  revalidate({ domain: 'admin', paths: ['/admin/teams-all', '/admin'] })
  return { id: team.id }
}

export interface UpdateTeamInput {
  id: string
  name?: string
}

export async function adminUpdateTeam(input: UpdateTeamInput) {
  await assertAdmin()
  if (!input.id) throw new Error('Team id required')
  const data: { name?: string } = {}
  if (input.name !== undefined) {
    const trimmed = input.name.trim()
    if (!trimmed) throw new Error('Team name cannot be empty')
    data.name = trimmed
  }
  if (Object.keys(data).length === 0) return
  await prisma.team.update({ where: { id: input.id }, data })
  revalidate({ domain: 'admin', paths: ['/admin/teams-all', '/admin'] })
}

export async function adminUpdateTeamLogo(input: { id: string; logoUrl: string | null }) {
  await assertAdmin()
  if (!input.id) throw new Error('Team id required')
  // Defense in depth: when setting a non-null URL, require it match the
  // team-logo pathname produced by the upload-token route. The token
  // route is the primary gate; this catches forged URLs that bypass it.
  if (input.logoUrl !== null) {
    const url = input.logoUrl.trim()
    if (!url) {
      await prisma.team.update({ where: { id: input.id }, data: { logoUrl: null } })
    } else {
      if (!isOwnedTeamLogoUrl(url, input.id)) {
        throw new Error('Logo URL does not match expected team-logo path')
      }
      await prisma.team.update({ where: { id: input.id }, data: { logoUrl: url } })
    }
  } else {
    await prisma.team.update({ where: { id: input.id }, data: { logoUrl: null } })
  }
  revalidate({ domain: 'admin', paths: ['/admin/teams-all', '/admin'] })
}

function isOwnedTeamLogoUrl(url: string, teamId: string): boolean {
  try {
    const u = new URL(url)
    return u.pathname.includes(`/team-logo/${teamId}/`)
  } catch {
    return false
  }
}

export async function adminDeleteTeam(input: { id: string }) {
  await assertAdmin()
  if (!input.id) throw new Error('Team id required')
  // Block delete when any LeagueTeam still has player memberships, so
  // admins reassign players first instead of cascading them off rosters.
  const playerCount = await prisma.playerLeagueMembership.count({
    where: { leagueTeam: { teamId: input.id } },
  })
  if (playerCount > 0) {
    throw new Error(
      `Cannot delete team: ${playerCount} player assignment(s) reference it. Remove or reassign players first.`,
    )
  }
  // Block delete when any Match still references this team's LeagueTeam
  // rows — Match.homeTeamId / awayTeamId is a LeagueTeam id (not a Team
  // id). Deleting the Team would cascade-delete the LeagueTeam rows and
  // 500 on the Match FK.
  const matchCount = await prisma.match.count({
    where: {
      OR: [
        { homeTeam: { teamId: input.id } },
        { awayTeam: { teamId: input.id } },
      ],
    },
  })
  if (matchCount > 0) {
    throw new Error(
      `Cannot delete team: ${matchCount} match(es) still reference it. Delete the matches first.`,
    )
  }
  await prisma.team.delete({ where: { id: input.id } })
  revalidate({ domain: 'admin', paths: ['/admin/teams-all', '/admin'] })
}
