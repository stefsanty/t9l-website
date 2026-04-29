'use client'

import { useState, useTransition } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useToast } from './ToastProvider'
import ConfirmDialog from './ConfirmDialog'
import { createVenue, updateVenue, deleteVenue } from '@/app/admin/venues/actions'

export interface VenueRow {
  id: string
  name: string
  address: string | null
  city: string | null
  notes: string | null
  url: string | null
  courtSize: string | null
  gameWeekCount: number
  matchCount: number
}

interface VenuesListProps {
  venues: VenueRow[]
}

export default function VenuesList({ venues }: VenuesListProps) {
  const { toast } = useToast()
  const [showAdd, setShowAdd] = useState(false)
  const [pending, startTransition] = useTransition()

  function onCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const name = (fd.get('name') as string).trim()
    if (!name) return
    const input = {
      name,
      address: (fd.get('address') as string) || null,
      city: (fd.get('city') as string) || null,
      url: (fd.get('url') as string) || null,
      courtSize: (fd.get('courtSize') as string) || null,
      notes: (fd.get('notes') as string) || null,
    }
    startTransition(async () => {
      try {
        await createVenue(input)
        toast('Venue created')
        setShowAdd(false)
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to create venue')
      }
    })
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-condensed font-bold text-[11px] uppercase tracking-[3px] text-admin-text3">
          Venues ({venues.length})
        </h1>
        <button
          type="button"
          onClick={() => setShowAdd((s) => !s)}
          className="flex items-center gap-1.5 rounded-[6px] border border-admin-border bg-admin-surface px-3 py-1.5 text-xs text-admin-text2 transition-colors hover:border-admin-border2 hover:text-admin-text"
        >
          <Plus className="w-3.5 h-3.5" />
          {showAdd ? 'Cancel' : 'Add venue'}
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={onCreateSubmit}
          className="mb-6 grid gap-3 rounded-lg border border-admin-border bg-admin-surface p-4 md:grid-cols-2"
        >
          <input
            name="name"
            required
            placeholder="Name (required)"
            className="bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-2 outline-none focus:border-admin-green md:col-span-2"
          />
          <input
            name="address"
            placeholder="Address"
            className="bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-2 outline-none focus:border-admin-green"
          />
          <input
            name="city"
            placeholder="City"
            className="bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-2 outline-none focus:border-admin-green"
          />
          <input
            name="url"
            placeholder="URL (https://…)"
            className="bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-2 outline-none focus:border-admin-green"
          />
          <input
            name="courtSize"
            placeholder="Court size"
            className="bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-2 outline-none focus:border-admin-green"
          />
          <input
            name="notes"
            placeholder="Notes"
            className="bg-admin-surface2 border border-admin-border2 text-admin-text text-sm rounded-md px-3 py-2 outline-none focus:border-admin-green md:col-span-2"
          />
          <div className="md:col-span-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-[6px] border border-admin-border bg-transparent px-3 py-1.5 text-xs text-admin-text2 hover:border-admin-border2 hover:text-admin-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-[6px] border border-admin-green bg-admin-green/10 px-3 py-1.5 text-xs text-admin-green hover:bg-admin-green/20 disabled:opacity-50"
            >
              {pending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {venues.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-24 text-admin-text3">
          <p className="font-condensed text-base font-semibold text-admin-text2">No venues yet</p>
          <p className="text-sm">Add your first venue to use it on matchdays.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-admin-border">
          <table className="w-full text-sm">
            <thead className="bg-admin-surface2 text-admin-text3">
              <tr>
                <th className="text-left font-condensed font-semibold uppercase tracking-[2px] text-[11px] px-3 py-2">Name</th>
                <th className="text-left font-condensed font-semibold uppercase tracking-[2px] text-[11px] px-3 py-2">City</th>
                <th className="text-left font-condensed font-semibold uppercase tracking-[2px] text-[11px] px-3 py-2 hidden md:table-cell">Address</th>
                <th className="text-left font-condensed font-semibold uppercase tracking-[2px] text-[11px] px-3 py-2 hidden md:table-cell">Court</th>
                <th className="text-left font-condensed font-semibold uppercase tracking-[2px] text-[11px] px-3 py-2">URL</th>
                <th className="text-left font-condensed font-semibold uppercase tracking-[2px] text-[11px] px-3 py-2">Used by</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {venues.map((v) => (
                <VenueRow key={v.id} venue={v} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function VenueRow({ venue }: { venue: VenueRow }) {
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()

  function saveField(field: 'name' | 'address' | 'city' | 'url' | 'courtSize' | 'notes', value: string) {
    if ((venue[field] ?? '') === value) return
    startTransition(async () => {
      try {
        await updateVenue(venue.id, {
          name: venue.name,
          address: venue.address,
          city: venue.city,
          notes: venue.notes,
          url: venue.url,
          courtSize: venue.courtSize,
          [field]: value,
        })
        toast('Venue updated')
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to update')
      }
    })
  }

  function handleDelete() {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          await deleteVenue(venue.id)
          toast('Venue deleted')
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Failed to delete')
        }
        resolve()
      })
    })
  }

  const usageLabel =
    venue.gameWeekCount + venue.matchCount === 0
      ? 'unused'
      : [venue.gameWeekCount && `${venue.gameWeekCount} matchday${venue.gameWeekCount === 1 ? '' : 's'}`,
         venue.matchCount && `${venue.matchCount} match${venue.matchCount === 1 ? '' : 'es'}`]
          .filter(Boolean).join(', ')

  return (
    <tr className="text-admin-text2 hover:bg-admin-surface3/40">
      <td className="px-3 py-2"><InlineField value={venue.name} onSave={(v) => saveField('name', v)} /></td>
      <td className="px-3 py-2"><InlineField value={venue.city ?? ''} onSave={(v) => saveField('city', v)} placeholder="—" /></td>
      <td className="px-3 py-2 hidden md:table-cell"><InlineField value={venue.address ?? ''} onSave={(v) => saveField('address', v)} placeholder="—" /></td>
      <td className="px-3 py-2 hidden md:table-cell"><InlineField value={venue.courtSize ?? ''} onSave={(v) => saveField('courtSize', v)} placeholder="—" /></td>
      <td className="px-3 py-2"><InlineField value={venue.url ?? ''} onSave={(v) => saveField('url', v)} placeholder="—" /></td>
      <td className="px-3 py-2 text-xs text-admin-text3">{usageLabel}</td>
      <td className="px-3 py-2 text-right">
        <ConfirmDialog
          trigger={
            <button
              type="button"
              disabled={pending || venue.gameWeekCount + venue.matchCount > 0}
              title={venue.gameWeekCount + venue.matchCount > 0 ? 'In use — reassign matchdays/matches first' : 'Delete venue'}
              className="rounded-[6px] border border-admin-border bg-transparent p-1.5 text-admin-text3 hover:border-admin-red hover:text-admin-red disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          }
          title="Delete venue?"
          description={`"${venue.name}" will be permanently removed.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          variant="danger"
        />
      </td>
    </tr>
  )
}

function InlineField({
  value,
  onSave,
  placeholder,
}: {
  value: string
  onSave: (v: string) => void
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); onSave(draft.trim()) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.currentTarget.blur() }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className="bg-admin-surface3 border border-admin-green/50 text-admin-text text-sm rounded px-2 py-0.5 outline-none focus:border-admin-green w-full"
      />
    )
  }
  return (
    <span
      onClick={() => { setDraft(value); setEditing(true) }}
      className="cursor-pointer hover:text-admin-text rounded px-1 -mx-1 transition-colors hover:bg-admin-surface3"
    >
      {value || <span className="text-admin-text3">{placeholder ?? '—'}</span>}
    </span>
  )
}
