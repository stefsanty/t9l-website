'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import CreateLeagueModal from './CreateLeagueModal'

export default function NewLeagueButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[6px] bg-admin-green px-3.5 py-1.5 text-[13px] font-semibold tracking-[0.2px] text-admin-ink hover:opacity-90 transition-opacity"
      >
        <Plus className="w-3.5 h-3.5" />
        New League
      </button>
      <CreateLeagueModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
