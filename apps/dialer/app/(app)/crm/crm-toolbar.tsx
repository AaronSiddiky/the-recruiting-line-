'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Search, Upload, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ImportDialog } from './import-dialog'
import { CALL_OUTCOMES } from '@/lib/constants'

export function CrmToolbar({ total }: { total: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [importOpen, setImportOpen] = useState(false)
  const urlQuery = params.get('q') ?? ''
  const [search, setSearch] = useState(urlQuery)
  const [syncedQuery, setSyncedQuery] = useState(urlQuery)

  // Keep the box in sync when the user navigates back/forward. Adjusting state
  // during render is the supported way to do this -- an effect here would fire
  // a second render pass on every navigation.
  if (urlQuery !== syncedQuery) {
    setSyncedQuery(urlQuery)
    setSearch(urlQuery)
  }

  function apply(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString())
    mutate(next)
    next.delete('page') // any filter change invalidates the current page
    startTransition(() => router.replace(`${pathname}?${next.toString()}`))
  }

  // Debounce so a fast typist doesn't fire a query per keystroke.
  useEffect(() => {
    if (search === urlQuery) return
    const id = setTimeout(() => {
      apply((next) => (search ? next.set('q', search) : next.delete('q')))
    }, 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const selectClass =
    'h-8 rounded-md border border-border-strong bg-background px-2 text-sm text-muted hover:text-foreground focus:outline-2 focus:outline-accent'

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-2"
            aria-hidden
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone"
            aria-label="Search companies"
            className="h-8 w-56 rounded-md border border-border-strong bg-background pr-2 pl-7 text-sm focus:outline-2 focus:outline-accent"
          />
        </div>

        <select
          aria-label="Filter by response"
          value={params.get('response') ?? ''}
          onChange={(e) =>
            apply((next) =>
              e.target.value ? next.set('response', e.target.value) : next.delete('response'),
            )
          }
          className={selectClass}
        >
          <option value="">Any response</option>
          <option value="none">No response yet</option>
          {CALL_OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by owner"
          value={params.get('owner') ?? ''}
          onChange={(e) =>
            apply((next) =>
              e.target.value ? next.set('owner', e.target.value) : next.delete('owner'),
            )
          }
          className={selectClass}
        >
          <option value="">Anyone&apos;s</option>
          <option value="me">My leads</option>
          <option value="unassigned">Unassigned</option>
        </select>

        <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border-strong px-2 text-sm text-muted hover:text-foreground">
          <input
            type="checkbox"
            checked={params.get('due') === '1'}
            onChange={(e) =>
              apply((next) => (e.target.checked ? next.set('due', '1') : next.delete('due')))
            }
            className="size-3.5 accent-[var(--accent)]"
          />
          Due today
        </label>

        <div className="ml-auto flex items-center gap-3">
          <span className="tnum text-xs text-muted">
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" aria-label="Loading" />
            ) : (
              `${total.toLocaleString()} ${total === 1 ? 'company' : 'companies'}`
            )}
          </span>
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="size-3.5" aria-hidden />
            Import CSV
          </Button>
        </div>
      </div>

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </>
  )
}
