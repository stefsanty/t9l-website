'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Calendar, Settings, Menu, ArrowLeft } from 'lucide-react'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const links = [
  { href: '/admin',          label: 'Dashboard',       icon: LayoutDashboard },
  { href: '/admin/players',  label: 'Players',          icon: Users },
  { href: '/admin/matches',  label: 'Matches',          icon: Calendar },
  { href: '/admin/settings', label: 'League Settings',  icon: Settings },
]

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 p-3 flex-1">
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname === href
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

export default function AdminSidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile sticky header */}
      <div className="md:hidden sticky top-0 z-40 flex items-center gap-3 border-b border-border bg-background px-4 h-14">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 flex flex-col">
            <div className="px-4 py-4 border-b border-border">
              <span className="font-bold text-sm tracking-wide">T9L Admin</span>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            <div className="px-4 py-3 border-t border-border">
              <Link
                href="/"
                onClick={() => setOpen(false)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors no-underline"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to site
              </Link>
            </div>
          </SheetContent>
        </Sheet>
        <span className="font-semibold text-sm">T9L Admin</span>
      </div>

      {/* Desktop fixed sidebar */}
      <aside className="hidden md:flex flex-col w-56 border-r border-border bg-card shrink-0 min-h-screen">
        <div className="px-4 py-5 border-b border-border">
          <span className="font-bold text-sm tracking-wide">T9L Admin</span>
        </div>
        <NavLinks pathname={pathname} />
        <div className="px-4 py-3 border-t border-border mt-auto">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors no-underline"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to site
          </Link>
        </div>
      </aside>
    </>
  )
}
