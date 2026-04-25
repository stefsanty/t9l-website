'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  trigger: React.ReactNode
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => Promise<void>
  variant?: 'danger' | 'warning'
}

export default function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  variant = 'danger',
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleConfirm() {
    startTransition(async () => {
      await onConfirm()
      setOpen(false)
    })
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="relative bg-admin-surface border border-admin-border rounded-xl p-6 w-full max-w-sm mx-4 shadow-2xl">
            <h3 className="text-admin-text font-condensed font-bold text-lg mb-2">{title}</h3>
            <p className="text-admin-text2 text-sm mb-6">{description}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-lg text-sm text-admin-text2 border border-admin-border hover:border-admin-border2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={pending}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50',
                  variant === 'danger'
                    ? 'bg-admin-red-dim text-admin-red border border-admin-red/30 hover:bg-admin-red/20'
                    : 'bg-admin-amber-dim text-admin-amber border border-admin-amber/30 hover:bg-admin-amber/20',
                )}
              >
                {pending ? 'Deleting…' : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
