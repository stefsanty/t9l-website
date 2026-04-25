'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import AdminNav from './AdminNav'

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Mobile header */}
      <header className="md:hidden sticky top-0 z-40 flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <AdminNav onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <span className="text-white font-bold text-sm">T9L Admin</span>
      </header>

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-56 bg-gray-900 border-r border-gray-800 min-h-screen flex-col shrink-0 sticky top-0 h-screen overflow-y-auto">
          <AdminNav />
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 p-4 md:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
