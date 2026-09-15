'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp, Check, Plus, Star } from 'lucide-react'
import { updateCompany } from '@/lib/actions/companies'
import { cn, formatPhone } from '@/lib/utils'
import type { Company, Profile } from '@/types/db'

export type LeadRow = Pick<
  Company,
  'id' | 'name' | 'phone' | 'city' | 'state' | 'source' | 'reached_out' | 'call_count' | 'owner_id' | 'priority'
>

const COLUMNS = [
  { key: 'priority', label: '', sortable: false },
  { key: 'name', label: 'Company', sortable: true },
  { key: 'phone', label: 'Phone', sortable: false },
  { key: 'location', label: 'Location', sortable: true },
  { key: 'source', label: 'Source', sortable: true },
  { key: 'crm', label: 'CRM', sortable: true },
  { key: 'assigned', label: 'Assigned to', sortable: false },
] as const

export function LeadsTable({
  rows,
  profiles,
  currentUserId,
  page,
  pageSize,
  total,
}: {
  rows: LeadRow[]
  profiles: Pick<Profile, 'id' | 'full_name'>[]
  currentUserId: string | null
  page: number
  pageSize: number
  total: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const sort = params.get('sort') ?? 'name'
  const dir = params.get('dir') ?? 'asc'

  function hrefWith(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString())
    mutate(next)
    return `${pathname}?${next.toString()}`
  }

  function save(id: string, patch: Record<string, unknown>) {
    setError(null)
    startTransition(async () => {
      const res = await updateCompany(id, patch)
      if (res.error) {
        setError(`Could not save: ${res.error}`)
        router.refresh()
      }
    })
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-12 text-center">
        <div>
          <p className="text-sm font-medium">No leads match.</p>
          <p className="mt-1 text-xs text-muted">Clear the filters, or import a lead list.</p>
        </div>
      </div>
    )
  }

  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <div role="alert" className="border-b border-bad-bg bg-bad-bg px-4 py-2 text-sm text-bad">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className="border-b border-border-subtle bg-surface px-4 py-2 text-left text-xs font-medium whitespace-nowrap text-muted"
                >
                  {col.sortable ? (
                    <Link
                      href={hrefWith((n) => {
                        n.set('sort', col.key)
                        n.set('dir', sort === col.key && dir === 'asc' ? 'desc' : 'asc')
                        n.delete('page')
                      })}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {col.label}
                      {sort === col.key &&
                        (dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </Link>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface">
                <td className="border-b border-border-subtle pl-3 pr-0 py-2">
                  <PriorityCell
                    key={`${row.id}:${row.priority}`}
                    lead={row}
                    onChange={(priority) => save(row.id, { priority })}
                  />
                </td>

                <td className="border-b border-border-subtle px-4 py-2">
                  <Link href={`/companies/${row.id}`} className="font-medium hover:text-accent hover:underline">
                    {row.name}
                  </Link>
                </td>

                <td className="tnum border-b border-border-subtle px-4 py-2 whitespace-nowrap text-muted">
                  {formatPhone(row.phone)}
                </td>

                <td className="border-b border-border-subtle px-4 py-2 whitespace-nowrap text-muted">
                  {[row.city, row.state].filter(Boolean).join(', ') || '—'}
                </td>

                <td className="border-b border-border-subtle px-4 py-2">
                  <SourceCell
                    key={`${row.id}:${row.source ?? ''}`}
                    lead={row}
                    onSave={(source) => save(row.id, { source })}
                  />
                </td>

                <td className="border-b border-border-subtle px-4 py-2">
                  <CrmCell
                    key={`${row.id}:${row.reached_out}`}
                    lead={row}
                    onChange={(reached_out) => save(row.id, { reached_out })}
                  />
                </td>

                <td className="border-b border-border-subtle px-4 py-2">
                  <select
                    aria-label={`Assign ${row.name}`}
                    defaultValue={row.owner_id ?? ''}
                    onChange={(e) => save(row.id, { owner_id: e.target.value || null })}
                    className="max-w-48 cursor-pointer truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border-strong focus:border-border-strong focus:outline-none"
                  >
                    <option value="">Unassigned</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                        {p.id === currentUserId ? ' (you)' : ''}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lastPage > 1 && (
        <div className="flex shrink-0 items-center justify-between border-t border-border-subtle px-4 py-2 text-xs text-muted">
          <span className="tnum">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
          </span>
          <div className="flex gap-3">
            {page > 1 && <Link href={hrefWith((n) => n.set('page', String(page - 1)))} className="hover:text-foreground">← Previous</Link>}
            {page < lastPage && <Link href={hrefWith((n) => n.set('page', String(page + 1)))} className="hover:text-foreground">Next →</Link>}
          </div>
        </div>
      )}
    </div>
  )
}

/** Plain text until focused; saves on blur or Enter, Escape reverts. */
function SourceCell({ lead, onSave }: { lead: LeadRow; onSave: (source: string | null) => void }) {
  const [value, setValue] = useState(lead.source ?? '')
  const commit = () => {
    const next = value.trim()
    if (next !== (lead.source ?? '')) onSave(next || null)
  }
  return (
    <input
      value={value}
      placeholder="Add source"
      aria-label={`Source for ${lead.name}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setValue(lead.source ?? '')
          requestAnimationFrame(() => e.currentTarget?.blur())
        }
      }}
      maxLength={100}
      className="w-48 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm placeholder:text-muted-2 hover:border-border-strong focus:border-border-strong focus:outline-none"
    />
  )
}

/**
 * A lead joins the CRM once it has been contacted. Calling does that
 * automatically; this lets a rep add one they reached some other way. A lead
 * with call history stays in the CRM, since the contact really happened.
 */
function CrmCell({ lead, onChange }: { lead: LeadRow; onChange: (value: boolean) => void }) {
  const [inCrm, setInCrm] = useState(lead.reached_out)
  const set = (next: boolean) => {
    setInCrm(next)
    onChange(next)
  }

  if (!inCrm) {
    return (
      <button
        type="button"
        onClick={() => set(true)}
        aria-label={`Add ${lead.name} to CRM`}
        className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-border-strong px-2 text-xs font-medium whitespace-nowrap text-foreground hover:bg-surface-2"
      >
        <Plus className="size-3" aria-hidden />
        Add to CRM
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <Link
        href={`/crm?q=${encodeURIComponent(lead.name)}`}
        className="inline-flex h-6 items-center gap-1 rounded-md bg-good-bg px-2 text-xs font-medium text-good hover:underline"
      >
        <Check className="size-3" aria-hidden />
        In CRM
      </Link>
      {lead.call_count === 0 && (
        <button
          type="button"
          onClick={() => set(false)}
          aria-label={`Remove ${lead.name} from CRM`}
          className={cn('cursor-pointer text-xs text-muted-2 hover:text-bad')}
        >
          Remove
        </button>
      )}
    </span>
  )
}

/**
 * "Call first": the dialer picks starred leads ahead of everything else, and
 * clears the star the moment one is dialed, so it is a one-time bump.
 */
function PriorityCell({ lead, onChange }: { lead: LeadRow; onChange: (value: boolean) => void }) {
  const [on, setOn] = useState(lead.priority)
  return (
    <button
      type="button"
      onClick={() => {
        setOn(!on)
        onChange(!on)
      }}
      aria-pressed={on}
      title={on ? 'Dialed first. Click to remove.' : 'Call first'}
      aria-label={`${on ? 'Remove' : 'Set'} call-first for ${lead.name}`}
      className={cn('cursor-pointer rounded p-1', on ? 'text-warn' : 'text-muted-2 opacity-40 hover:opacity-100')}
    >
      <Star className="size-3.5" fill={on ? 'currentColor' : 'none'} aria-hidden />
    </button>
  )
}
