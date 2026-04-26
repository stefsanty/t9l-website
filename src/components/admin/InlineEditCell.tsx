'use client'

import { useRef, useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

interface InlineEditCellProps {
  value: string
  displayValue?: React.ReactNode
  onSave: (value: string) => Promise<void>
  type?: 'text' | 'number' | 'datetime-local' | 'date' | 'time'
  className?: string
  inputClassName?: string
  placeholder?: string
}

export default function InlineEditCell({
  value,
  displayValue,
  onSave,
  type = 'text',
  className,
  inputClassName,
  placeholder,
}: InlineEditCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    setDraft(value)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function cancel() {
    setEditing(false)
    setDraft(value)
  }

  function save() {
    if (draft === value) { setEditing(false); return }
    startTransition(async () => {
      await onSave(draft)
      setEditing(false)
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); save() }
    if (e.key === 'Escape') cancel()
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        type={type}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={save}
        disabled={pending}
        className={cn(
          'bg-admin-surface3 border border-admin-green/50 text-admin-text text-sm rounded px-2 py-0.5 outline-none focus:border-admin-green font-mono w-full',
          inputClassName,
        )}
      />
    )
  }

  return (
    <span
      onClick={startEdit}
      className={cn('cursor-pointer hover:text-admin-text rounded px-1 -mx-1 transition-colors hover:bg-admin-surface3', className)}
    >
      {displayValue ?? value}
    </span>
  )
}
