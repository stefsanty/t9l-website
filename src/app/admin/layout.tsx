import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import AdminNav from '@/components/admin/AdminNav'
import ToastProvider from '@/components/admin/ToastProvider'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  const isAdmin = !!session?.isAdmin

  return (
    <div
      className="admin-shell dark flex flex-col min-h-screen bg-admin-bg text-admin-text"
      style={{ fontFamily: 'var(--font-barlow-sans), system-ui, sans-serif' }}
    >
      <ToastProvider>
        {isAdmin && <AdminNav adminName={session.user?.name} />}
        <main className="flex-1 overflow-x-hidden">
          {children}
        </main>
      </ToastProvider>
    </div>
  )
}
