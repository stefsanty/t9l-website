import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import AdminNav from '@/components/admin/AdminNav'
import ToastProvider from '@/components/admin/ToastProvider'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session?.isAdmin) redirect('/')

  return (
    <div style={{ fontFamily: 'var(--font-barlow-sans), system-ui, sans-serif' }}>
      {/* Mobile banner */}
      <div className="lg:hidden flex items-center justify-center min-h-screen bg-admin-bg text-admin-text2 text-sm text-center p-8">
        The admin panel is designed for desktop. Please open on a screen wider than 1024px.
      </div>

      {/* Desktop layout */}
      <div className="hidden lg:flex flex-col min-h-screen bg-admin-bg text-admin-text">
        <ToastProvider>
          <AdminNav adminName={session.user?.name} />
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </ToastProvider>
      </div>
    </div>
  )
}
