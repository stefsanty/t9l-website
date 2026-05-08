import { getServerSession } from 'next-auth'
import { Barlow, DM_Mono } from 'next/font/google'
import { authOptions } from '@/lib/auth'
import AdminNav from '@/components/admin/AdminNav'
import ToastProvider from '@/components/admin/ToastProvider'
import VersionFooter from '@/components/VersionFooter'

// v1.80.6 — phase 4 perf: admin-only fonts. Pre-v1.80.6 these loaded in
// the root layout and shipped to every public visitor (5 woff2 files,
// ~50 KiB transferred per public page load). Barlow Sans is used only
// here as the admin body font; DM Mono is used in admin-shell mono
// blocks (`font-mono` Tailwind class via `--font-condensed` /
// `--font-mono` aliases in globals.css). Public pages no longer load
// either — the `font-mono` class on `/join/[code]` falls through to
// the `monospace` system fallback declared in globals.css.
const barlowSans = Barlow({
  variable: '--font-barlow-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
})

const dmMono = DM_Mono({
  variable: '--font-dm-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
})

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  const isAdmin = !!session?.isAdmin

  return (
    <div
      className={`admin-shell dark flex flex-col min-h-screen bg-admin-bg text-admin-text ${barlowSans.variable} ${dmMono.variable}`}
      style={{ fontFamily: 'var(--font-barlow-sans), system-ui, sans-serif' }}
    >
      <ToastProvider>
        {isAdmin && <AdminNav adminName={session.user?.name} />}
        <main className="flex-1 overflow-x-hidden">
          {children}
        </main>
        <VersionFooter variant="admin" />
      </ToastProvider>
    </div>
  )
}
