import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

function toSlug(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function GET(req: NextRequest) {
  const value = req.nextUrl.searchParams.get('value')?.trim() ?? ''
  if (!value) return NextResponse.json({ available: false })

  const leagues = await prisma.league.findMany({ select: { name: true } })
  const taken = leagues.some((l) => toSlug(l.name) === value)

  return NextResponse.json({ available: !taken })
}
