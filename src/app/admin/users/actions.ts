'use server'

/**
 * v2.2.15 — admin server actions for User-level ID attestation +
 * re-upload request flags.
 *
 * Four mutually-paired actions, each `assertAdmin()`-gated:
 *
 *   markUserIdExternal        — flip on  (sets ts, optional notes)
 *   revokeUserIdExternal      — flip off (clears ts + notes)
 *   requestUserIdReupload     — flip on  (sets ts, optional notes)
 *   cancelUserIdReuploadRequest — flip off (clears ts + notes)
 *
 * The flip is the source of truth; `*At` / `*Notes` are operator-
 * facing audit metadata. Cleared together with the bool on revoke so
 * stale notes don't linger.
 *
 * All revalidate `domain: 'admin'` so the admin Users list re-fetches
 * after each toggle.
 */

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { revalidate } from '@/lib/revalidate'
import { prisma } from '@/lib/prisma'

// Mirrors `assertAdmin()` in `src/app/admin/leagues/actions.ts:71`.
// Inlined here rather than imported because that file is a 'use server'
// module and re-exporting helpers across server-action modules creates
// confusing endpoint surfaces. One-line helper; not worth a shared
// neutral module just for this.
async function assertAdmin(): Promise<void> {
  const session = await getServerSession(authOptions)
  if (!session?.isAdmin) throw new Error('Unauthorized')
}

const NOTES_MAX = 500

function normaliseNotes(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.length > NOTES_MAX) {
    throw new Error(`Notes must be ${NOTES_MAX} characters or fewer`)
  }
  return trimmed
}

export async function markUserIdExternal(
  userId: string,
  notes?: string | null,
): Promise<void> {
  await assertAdmin()
  if (typeof userId !== 'string' || !userId) {
    throw new Error('userId is required')
  }
  const normalised = normaliseNotes(notes)
  await prisma.user.update({
    where: { id: userId },
    data: {
      idCollectedExternally: true,
      idCollectedExternallyAt: new Date(),
      idCollectedExternallyNotes: normalised,
    },
  })
  revalidate({ domain: 'admin', paths: ['/admin/users'] })
}

export async function revokeUserIdExternal(userId: string): Promise<void> {
  await assertAdmin()
  if (typeof userId !== 'string' || !userId) {
    throw new Error('userId is required')
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      idCollectedExternally: false,
      idCollectedExternallyAt: null,
      idCollectedExternallyNotes: null,
    },
  })
  revalidate({ domain: 'admin', paths: ['/admin/users'] })
}

export async function requestUserIdReupload(
  userId: string,
  notes?: string | null,
): Promise<void> {
  await assertAdmin()
  if (typeof userId !== 'string' || !userId) {
    throw new Error('userId is required')
  }
  const normalised = normaliseNotes(notes)
  await prisma.user.update({
    where: { id: userId },
    data: {
      idReuploadRequested: true,
      idReuploadRequestedAt: new Date(),
      idReuploadRequestedNotes: normalised,
    },
  })
  revalidate({ domain: 'admin', paths: ['/admin/users'] })
}

export async function cancelUserIdReuploadRequest(userId: string): Promise<void> {
  await assertAdmin()
  if (typeof userId !== 'string' || !userId) {
    throw new Error('userId is required')
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      idReuploadRequested: false,
      idReuploadRequestedAt: null,
      idReuploadRequestedNotes: null,
    },
  })
  revalidate({ domain: 'admin', paths: ['/admin/users'] })
}
