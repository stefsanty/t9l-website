import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAllUsersForAdmin } from '@/lib/admin-data'
import UsersList from '@/components/admin/UsersList'

/**
 * v1.57.0 (PR 4 of route-shortening chain) — admin Users list.
 *
 * Surfaces every User row in the system, annotated with auth providers
 * (LINE / Google / Email — derived from `Account.provider`), the
 * Player they're bound to (if any), the leagues that Player is in,
 * and the most recent LINE login timestamp (when applicable).
 *
 * Hard-gated to admin role — non-admin sessions get redirected to
 * `/admin/login` (the existing admin shell layout shows nothing for
 * non-admins, but redirecting from this specific surface is more
 * direct than relying on layout-level chrome).
 *
 * Search / sort / filter happens client-side in `UsersList`.
 *
 * Out of scope (left as user-action affordances on individual rows):
 *   - User disable (would need a schema column; deferred)
 *   - Provider unlink (would need to delete an `Account` row — admin
 *     ergonomics are tricky, deferred to a follow-up PR if needed)
 *   - Bulk operations
 */
export default async function AdminUsersPage() {
  const session = await getServerSession(authOptions)
  if (!session?.isAdmin) {
    redirect('/admin/login')
  }

  const users = await getAllUsersForAdmin()

  return <UsersList users={users} />
}
