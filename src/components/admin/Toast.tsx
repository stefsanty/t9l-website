'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastVariant = 'success' | 'error' | 'warning'

export interface Toast {
  id: string
  message: string
  variant: ToastVariant
}

const variantClasses: Record<ToastVariant, string> = {
  success: 'bg-admin-green-dim border-admin-green/40 text-admin-green',
  error:   'bg-admin-red-dim border-admin-red/40 text-admin-red',
  warning: 'bg-admin-amber-dim border-admin-amber/40 text-admin-amber',
}

interface ToastItemProps {
  toast: Toast
  onDismiss: (id: string) => void
}

export function ToastItem({ toast, onDismiss }: ToastItemProps) {
  useEffect(() => {
    if (toast.variant !== 'error') {
      const t = setTimeout(() => onDismiss(toast.id), 4000)
      return () => clearTimeout(t)
    }
  }, [toast.id, toast.variant, onDismiss])

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-4 py-3 rounded-lg border text-sm font-mono animate-in',
        variantClasses[toast.variant],
      )}
    >
      <span>{toast.message}</span>
      <button onClick={() => onDismiss(toast.id)} className="shrink-0 opacity-70 hover:opacity-100">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
