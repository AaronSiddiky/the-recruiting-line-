'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ArrowDown, ArrowUp, PhoneOff, Trash2 } from 'lucide-react'
import { OutcomeBadge } from '@/components/ui/badge'
import { deleteCompany, updateCompany } from '@/lib/actions/companies'
import { cn, formatPhone, relativeDate } from '@/lib/utils'
import type { CompanyRow, Profile } from '@/types/db'

const COLUMNS = [
  { key: 'name', label: 'Company', sortable: true },
  { key: 'location', label: 'Location', sortable: true },
  { key: 'phone', label: 'Phone', sortable: false },
  { key: 'calls', label: 'Calls', sortable: true },
  { key: 'response', label: 'Response', sortable: true },
  { key: 'owner', label: 'Owner', sortable: false },
  { key: 'follow_up', label: 'Next follow-up', sortable: true },
  { key: 'notes', label: 'Notes', sortable: false },
  { key: 'actions', label: '', sortable: false },
] as const

export function CrmTable({
  rows,
  profiles,
  currentUserId,
  page,
  pageSize,
  total,
}: {
  rows: CompanyRow[]
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

  const sort = params.get('sort') ?? 'name'
  const dir = params.get('dir') ?? 'asc'

  function sortHref(key: string) {
    const next = new URLSearchParams(params.toString())
    next.set('sort', key)
    next.set('dir', sort === key && dir === 'asc' ? 'desc' : 'asc')
    next.delete('page')
    return `${pathname}?${next.toString()}`
  }

  function pageHref(target: number) {
    const next = new URLSearchParams(params.toString())
    next.set('page', String(target))
    return `${pathname}?${next.toString()}`
  }

  function save(id: string, patch: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateCompany(id, patch)
      if (res.error) {
        // The server refused (usually RLS: not your lead). Re-fetch so the row
        // snaps back to the truth instead of showing a lie.
        router.refresh()
      }
    })
  }

  function remove(row: CompanyRow) {
    const history = row.call_count
      ? ` Its ${row.call_count} ${row.call_count === 1 ? 'call' : 'calls'}, notes and recordings go with it.`
      : ''
    if (!window.confirm(`Delete ${row.name} from the CRM?${history} This cannot be undone.`)) return
    startTransition(async () => {
      const res = await deleteCompany(row.id)
      if (res.error) window.alert(res.error)
      router.refresh()
    })
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-12">
        <div className="text-center">
          <p className="text-sm font-medium">No companies match.</p>
          <p className="mt-1 text-xs text-muted">
            A company lands here once it has been called, or when you add it from Leads.
          </p>
        </div>
      </div>
    )
  }

  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className="border-b border-border-subtle bg-surface px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted"
                >
                  {col.sortable ? (
                    <Link
                      href={sortHref(col.key)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {col.label}
                      {sort === col.key &&
                        (dir === 'asc' ? (
                          <ArrowUp className="size-3" aria-label="ascending" />
                        ) : (
                          <ArrowDown className="size-3" aria-label="descending" />
                        ))}
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
              <tr key={row.id} className="group hover:bg-surface">
                <td className="border-b border-border-subtle px-3 py-1.5">
                  <Link
                    href={`/companies/${row.id}`}
                    className="font-medium hover:text-accent hover:underline"
                  >
                    {row.name}
                  </Link>
                  {row.do_not_call && (
                    <span
                      title="Do not call"
                      className="ml-1.5 inline-flex align-middle text-bad"
                    >
                      <PhoneOff className="size-3" aria-label="Do not call" />
                    </span>
                  )}
                </td>

                <td className="border-b border-border-subtle px-3 py-1.5 whitespace-nowrap text-muted">
                  {[row.city, row.state].filter(Boolean).join(', ') || '—'}
                </td>

                <td className="tnum border-b border-border-subtle px-3 py-1.5 whitespace-nowrap">
                  {formatPhone(row.phone)}
                </td>

                <td className="tnum border-b border-border-subtle px-3 py-1.5 whitespace-nowrap">
                  {row.call_count}
                  {row.last_called_at && (
                    <span className="ml-1.5 text-xs text-muted-2">
                      {relativeDate(row.last_called_at)}
                    </span>
                  )}
                </td>

                <td
                  className="border-b border-border-subtle px-3 py-1.5"
                  title="Set by the exit interview after a call"
                >
                  <OutcomeBadge outcome={row.response} />
                </td>

                <td className="border-b border-border-subtle px-3 py-1.5">
                  <select
                    aria-label={`Owner of ${row.name}`}
                    defaultValue={row.owner_id ?? ''}
                    onChange={(e) =>
                      save(row.id, { owner_id: e.target.value || null })
                    }
                    className="max-w-32 cursor-pointer truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border-strong focus:border-border-strong focus:outline-none"
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

                <td className="border-b border-border-subtle px-3 py-1.5">
                  <input
                    type="date"
                    aria-label={`Next follow-up for ${row.name}`}
                    defaultValue={row.next_follow_up ?? ''}
                    onChange={(e) =>
                      save(row.id, { next_follow_up: e.target.value || null })
                    }
                    className="tnum cursor-pointer rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border-strong focus:border-border-strong focus:outline-none"
                  />
                </td>

                <td className="border-b border-border-subtle px-3 py-1.5">
                  <NotesCell
                    company={row}
                    onSave={(notes) => save(row.id, { notes })}
                  />
                </td>

                <td className="border-b border-border-subtle px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => remove(row)}
                    title={`Delete ${row.name}`}
                    aria-label={`Delete ${row.name}`}
                    className="cursor-pointer rounded p-1 text-muted-2 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-bad-bg hover:text-bad focus:opacity-100"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lastPage > 1 && (
        <div className="flex shrink-0 items-center justify-between border-t border-border-subtle px-4 py-2 text-xs text-muted">
          <span className="tnum">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of{' '}
            {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="hover:text-foreground">
                ← Previous
              </Link>
            )}
            {page < lastPage && (
              <Link href={pageHref(page + 1)} className="hover:text-foreground">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Notes are the column people actually live in, so it stays a plain one-line
 * cell until focused, then grows. Saves on blur, not per keystroke.
 */
function NotesCell({
  company,
  onSave,
}: {
  company: CompanyRow
  onSave: (notes: string) => void
}) {
  const [value, setValue] = useState(company.notes ?? '')
  const [focused, setFocused] = useState(false)

  return (
    <textarea
      value={value}
      rows={focused ? 3 : 1}
      aria-label={`Notes for ${company.name}`}
      placeholder="—"
      onChange={(e) => setValue(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        if (value !== (company.notes ?? '')) onSave(value)
      }}
      className={cn(
        'w-64 resize-none rounded border border-transparent bg-transparent px-1 py-0.5 text-sm',
        'placeholder:text-muted-2 hover:border-border-strong focus:border-border-strong focus:outline-none',
        !focused && 'truncate whitespace-nowrap',
      )}
    />
  )
}
