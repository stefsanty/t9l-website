import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import AdminSidebar from '@/components/admin/AdminSidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session?.isAdmin) redirect('/')

  return (
    <div className="dark">
      <div className="flex flex-col md:flex-row min-h-screen bg-background text-foreground">
        <AdminSidebar />
        <main className="flex-1 p-4 md:p-8 overflow-auto min-w-0">{children}</main>
      </div>
    </div>
  )
}
