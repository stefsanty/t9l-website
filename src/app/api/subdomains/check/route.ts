import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const value   = req.nextUrl.searchParams.get('value')?.trim().toLowerCase() ?? ''
  const exclude = req.nextUrl.searchParams.get('exclude') ?? ''
  if (!value) return NextResponse.json({ available: false })

  const existing = await prisma.league.findFirst({
    where: { subdomain: value, NOT: exclude ? { id: exclude } : undefined },
    select: { id: true },
  })

  return NextResponse.json({ available: !existing })
}
