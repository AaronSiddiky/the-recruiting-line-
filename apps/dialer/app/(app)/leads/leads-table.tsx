'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { updateCompany } from '@/lib/actions/companies'
import { cn } from '@/lib/utils'
import type { Company, Profile } from '@/types/db'

export type LeadRow = Pick<Company, 'id' | 'name' | 'phone' | 'source' | 'reached_out' | 'owner_id'>

const COLUMNS = [
  { key: 'name', label: 'Company', sortable: true },
  { key: 'source', label: 'Source', sortable: true },
  { key: 'reached', label: 'Reached out', sortable: true },
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
        setError(
          /reached_out|source/.test(res.error)
            ? 'The leads columns are missing. Run supabase/migrations/0004_leads.sql in Supabase.'
            : `Could not save: ${res.error}`,
        )
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
                <td className="border-b border-border-subtle px-4 py-2">
                  <Link href={`/companies/${row.id}`} className="font-medium hover:text-accent hover:underline">
                    {row.name}
                  </Link>
                </td>

                <td className="border-b border-border-subtle px-4 py-2">
                  <SourceCell
                    key={`${row.id}:${row.source ?? ''}`}
                    lead={row}
                    onSave={(source) => save(row.id, { source })}
                  />
                </td>

                <td className="border-b border-border-subtle px-4 py-2">
                  <ReachedToggle
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

/** Yes/No segmented toggle. Optimistic: flips immediately, the server confirms. */
function ReachedToggle({ lead, onChange }: { lead: LeadRow; onChange: (value: boolean) => void }) {
  const [value, setValue] = useState(lead.reached_out)
  const set = (next: boolean) => {
    if (next === value) return
    setValue(next)
    onChange(next)
  }
  return (
    <div role="radiogroup" aria-label={`Reached out to ${lead.name}`} className="inline-flex rounded-md border border-border-strong p-0.5">
      {[
        { label: 'Yes', v: true },
        { label: 'No', v: false },
      ].map((opt) => (
        <button
          key={opt.label}
          type="button"
          role="radio"
          aria-checked={value === opt.v}
          onClick={() => set(opt.v)}
          className={cn(
            'h-6 min-w-10 cursor-pointer rounded px-2 text-xs font-medium transition-colors',
            value === opt.v
              ? opt.v
                ? 'bg-good-bg text-good'
                : 'bg-surface-2 text-foreground'
              : 'text-muted-2 hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
