/**
 * v1.71.2 — Admin Users page: ID thumbnails + viewer modal
 *
 * Regression targets:
 * - UserRow interface includes idFrontUrl / idBackUrl / idUploadedAt
 * - getAllUsersForAdmin selects those columns from User
 * - getAllUsersForAdmin return mapping includes all three fields
 * - UsersList renders thumbnail for users with idFrontUrl
 * - UsersList renders "—" placeholder for users without idFrontUrl
 * - "View ID" trigger element is present on rows that have an ID
 * - UserIdModal testid is present in the component source
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = (file: string) =>
  readFileSync(join(process.cwd(), 'src', file), 'utf-8')

const usersListSrc = src('components/admin/UsersList.tsx')
const adminDataSrc = ['leagues', 'players', 'stats', 'venues', 'users', 'teams', 'index']
  .map((n) => src('lib/admin-data/' + n + '.ts'))
  .join('\n')

// ── UserRow interface ────────────────────────────────────────────────────────

describe('UserRow interface (v1.71.2)', () => {
  it('declares idFrontUrl field', () => {
    expect(usersListSrc).toMatch(/idFrontUrl\s*:\s*string\s*\|\s*null/)
  })

  it('declares idBackUrl field', () => {
    expect(usersListSrc).toMatch(/idBackUrl\s*:\s*string\s*\|\s*null/)
  })

  it('declares idUploadedAt field', () => {
    expect(usersListSrc).toMatch(/idUploadedAt\s*:\s*string\s*\|\s*null/)
  })
})

// ── getAllUsersForAdmin Prisma select ────────────────────────────────────────

describe('getAllUsersForAdmin — Prisma select (v1.71.2)', () => {
  it('selects idFrontUrl from User', () => {
    expect(adminDataSrc).toMatch(/idFrontUrl\s*:\s*true/)
  })

  it('selects idBackUrl from User', () => {
    expect(adminDataSrc).toMatch(/idBackUrl\s*:\s*true/)
  })

  it('selects idUploadedAt from User', () => {
    expect(adminDataSrc).toMatch(/idUploadedAt\s*:\s*true/)
  })
})

// ── getAllUsersForAdmin return type ──────────────────────────────────────────

describe('getAllUsersForAdmin — return type (v1.71.2)', () => {
  // The Promise<Array<{...}>> return type block should declare all three fields
  const returnTypeBlock = adminDataSrc.slice(
    adminDataSrc.indexOf('export async function getAllUsersForAdmin'),
    adminDataSrc.indexOf('> {', adminDataSrc.indexOf('export async function getAllUsersForAdmin')),
  )

  it('return type declares idFrontUrl', () => {
    expect(returnTypeBlock).toMatch(/idFrontUrl\s*:\s*string\s*\|\s*null/)
  })

  it('return type declares idBackUrl', () => {
    expect(returnTypeBlock).toMatch(/idBackUrl\s*:\s*string\s*\|\s*null/)
  })

  it('return type declares idUploadedAt', () => {
    expect(returnTypeBlock).toMatch(/idUploadedAt\s*:\s*string\s*\|\s*null/)
  })
})

// ── getAllUsersForAdmin return mapping ───────────────────────────────────────

describe('getAllUsersForAdmin — return mapping (v1.71.2)', () => {
  it('maps idFrontUrl from the Prisma row', () => {
    // regression target: must include idFrontUrl: u.idFrontUrl in the return object
    expect(adminDataSrc).toMatch(/idFrontUrl\s*:\s*u\.idFrontUrl/)
  })

  it('maps idBackUrl from the Prisma row', () => {
    expect(adminDataSrc).toMatch(/idBackUrl\s*:\s*u\.idBackUrl/)
  })

  it('serialises idUploadedAt as ISO string or null', () => {
    // regression target: must convert Date | null → string | null
    expect(adminDataSrc).toMatch(/idUploadedAt\s*:.*idUploadedAt.*toISOString/)
  })
})

// ── UsersList component rendering ───────────────────────────────────────────

describe('UsersList component — ID column (v1.71.2)', () => {
  it('renders thumbnail testid for users with idFrontUrl', () => {
    expect(usersListSrc).toMatch(/data-testid=\{`admin-users-id-thumb-\$\{.*\}`\}/)
  })

  it('renders "none" placeholder testid for users without idFrontUrl', () => {
    expect(usersListSrc).toMatch(/data-testid=\{`admin-users-id-none-\$\{.*\}`\}/)
  })

  it('has a View ID trigger element (desktop)', () => {
    // The desktop row should have an IdThumbnailCell that wraps a button/img
    expect(usersListSrc).toContain('IdThumbnailCell')
  })

  it('has a View ID trigger on mobile rows', () => {
    expect(usersListSrc).toMatch(/data-testid=\{`admin-users-view-id-mobile-\$\{.*\}`\}/)
  })

  it('renders UserIdModal when viewingIdUser is set', () => {
    expect(usersListSrc).toContain('viewingIdUser')
    expect(usersListSrc).toContain('UserIdModal')
  })

  it('UserIdModal testid is present', () => {
    expect(usersListSrc).toContain('"user-id-modal"')
  })

  it('modal shows both front and back image testids', () => {
    expect(usersListSrc).toContain('user-id-modal-front')
    expect(usersListSrc).toContain('user-id-modal-back')
  })
})

// ── Column header added ──────────────────────────────────────────────────────

describe('UsersList — ID column header (v1.71.2)', () => {
  it('adds ID header to desktop grid', () => {
    expect(usersListSrc).toMatch(/<span>ID<\/span>/)
  })

  it('desktop grid column template includes 48px ID column (v2.2.15 widened Actions to 132px)', () => {
    // v2.2.15 — Actions column bumped 80px → 132px to fit two new
    // icon-only buttons (mark-external + request-reupload) alongside
    // the existing Unlink. ID column stays 48px.
    expect(usersListSrc).toContain('40px 1fr 180px 200px 48px 100px 132px')
  })
})

// ── Stash-pop regression: NOT importing Eye would break thumbnail ────────────

describe('Regression: icon imports (v1.71.2)', () => {
  it('imports Eye icon from lucide-react', () => {
    expect(usersListSrc).toMatch(/import.*Eye.*from 'lucide-react'/)
  })

  it('imports X icon from lucide-react (for modal close)', () => {
    expect(usersListSrc).toMatch(/import.*X.*from 'lucide-react'/)
  })
})
