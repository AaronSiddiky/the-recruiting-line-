'use client'

import { useEffect, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Search, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ImportDialog } from '../crm/import-dialog'
import type { Profile } from '@/types/db'

export function LeadsToolbar({
  total,
  reachedTotal,
  profiles,
  currentUserId,
}: {
  total: number
  reachedTotal: number
  profiles: Pick<Profile, 'id' | 'full_name'>[]
  currentUserId: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [importOpen, setImportOpen] = useState(false)

  const urlQuery = params.get('q') ?? ''
  const [search, setSearch] = useState(urlQuery)
  const [syncedQuery, setSyncedQuery] = useState(urlQuery)
  if (urlQuery !== syncedQuery) {
    setSyncedQuery(urlQuery)
    setSearch(urlQuery)
  }

  function apply(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString())
    mutate(next)
    next.delete('page')
    startTransition(() => router.replace(`${pathname}?${next.toString()}`))
  }

  useEffect(() => {
    if (search === urlQuery) return
    const id = setTimeout(() => apply((n) => (search ? n.set('q', search) : n.delete('q'))), 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const setParam = (key: string) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    apply((n) => (e.target.value ? n.set(key, e.target.value) : n.delete(key)))

  const selectClass =
    'h-8 rounded-md border border-border-strong bg-background px-2 text-sm text-muted hover:text-foreground focus:outline-2 focus:outline-accent'

  return (
    <>
      <div className="border-b border-border-subtle px-4 pt-4 pb-2.5">
        <div className="mb-3 flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Leads</h1>
          <span className="tnum text-xs text-muted">
            {reachedTotal.toLocaleString()} reached out
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-2" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or source"
              aria-label="Search leads"
              className="h-8 w-56 rounded-md border border-border-strong bg-background pr-2 pl-7 text-sm focus:outline-2 focus:outline-accent"
            />
          </div>

          <select aria-label="Filter by reached out" value={params.get('reached') ?? ''} onChange={setParam('reached')} className={selectClass}>
            <option value="">Reached out: any</option>
            <option value="yes">Reached out</option>
            <option value="no">Not reached out</option>
          </select>

          <select aria-label="Filter by assignee" value={params.get('assigned') ?? ''} onChange={setParam('assigned')} className={selectClass}>
            <option value="">Assigned to anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            {profiles
              .filter((p) => p.id !== currentUserId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
          </select>

          <div className="ml-auto flex items-center gap-3">
            <span className="tnum text-xs text-muted">
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" aria-label="Loading" />
              ) : (
                `${total.toLocaleString()} ${total === 1 ? 'lead' : 'leads'}`
              )}
            </span>
            <Button onClick={() => setImportOpen(true)}>
              <Upload className="size-3.5" aria-hidden />
              Import CSV
            </Button>
          </div>
        </div>
      </div>

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </>
  )
}
