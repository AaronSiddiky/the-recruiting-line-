'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ClipboardCheck, Plus, Trash2, Upload, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { createTech, deleteTech, importTechs, updateTech } from '@/lib/actions/techs'
import { formatPhone } from '@/lib/utils'
import type { Profile, Tech } from '@/types/db'

import { STAGES as STATUSES } from './[id]/tech-detail'

type Client = { id: string; name: string }

export function TechsTable({ rows, profiles, clients, q, status }: { rows: Tech[]; profiles: Pick<Profile, 'id' | 'full_name'>[]; clients: Client[]; q: string; status: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [, startTransition] = useTransition()
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    router.push(`${pathname}?${next.toString()}`)
  }
  function save(id: string, patch: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateTech(id, patch)
      setError(res.error)
      router.refresh()
    })
  }
  function remove(t: Tech) {
    if (!window.confirm(`Delete ${t.name ?? 'this tech'}?`)) return
    startTransition(async () => {
      await deleteTech(t.id)
      router.refresh()
    })
  }

  const cell = 'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border-strong focus:border-border-strong focus:outline-none'
  const counts = STATUSES.map((s) => ({ ...s, n: rows.filter((r) => r.status === s.value).length }))

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
        <h1 className="mr-2 text-sm font-semibold">Techs</h1>
        <input
          defaultValue={q}
          placeholder="Search name, phone, city, role…"
          aria-label="Search techs"
          onKeyDown={(e) => e.key === 'Enter' && setParam('q', (e.target as HTMLInputElement).value.trim())}
          className="h-8 w-64 rounded-md border border-border-strong bg-background px-2 text-sm"
        />
        <select value={status} onChange={(e) => setParam('status', e.target.value)} aria-label="Status" className="h-8 rounded-md border border-border-strong bg-background px-2 text-sm">
          <option value="">Any stage</option>
          <option value="due">Touch due</option>
          <option value="form">Form returned</option>
          <option value="noform">Form not returned</option>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <span className="tnum text-xs text-muted">{rows.length} shown</span>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setImporting(true)}><Upload className="size-3.5" aria-hidden />Import CSV</Button>
          <Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-3.5" aria-hidden />Add tech</Button>
        </div>
      </div>

      {!q && !status && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border-subtle px-4 py-1.5 text-xs text-muted">
          <button type="button" onClick={() => setParam('status', 'form')} className="cursor-pointer font-medium text-good hover:underline">
            Form returned <span className="tnum">{rows.filter((r) => r.screening_at).length}</span>
          </button>
          <button type="button" onClick={() => setParam('status', 'due')} className="cursor-pointer font-medium text-bad hover:underline">
            Touch due <span className="tnum">{rows.filter((r) => r.next_follow_up && r.next_follow_up <= new Date().toISOString().slice(0, 10) && ['contacting', 'screened', 'interviewing', 'presented'].includes(r.status)).length}</span>
          </button>
          {counts.map((s) => (
            <button key={s.value} type="button" onClick={() => setParam('status', s.value)} className="cursor-pointer hover:text-foreground">
              {s.label} <span className="tnum text-foreground">{s.n}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="px-4 py-2 text-xs text-bad">Could not save: {error}</p>}

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-12 text-center">
          <div>
            <p className="text-sm font-medium">No techs here.</p>
            <p className="mt-1 text-xs text-muted">Add one, import a CSV, or clear the filters.</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                {['Name', 'Phone', 'Location', 'Role', 'Experience', 'Next touch', 'Stage', 'Placed at', 'Owner', ''].map((h) => (
                  <th key={h} className="border-b border-border-subtle bg-surface px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="group align-top hover:bg-surface">
                  <td className="border-b border-border-subtle px-2 py-1.5">
                    <span className="flex items-center gap-1.5 px-1">
                      <Link href={`/techs/${t.id}`} className="font-medium hover:text-accent hover:underline">{t.name ?? 'Unnamed'}</Link>
                      {t.screening_at && (
                        <span
                          title={`Filled in the form ${new Date(t.screening_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${t.looking === false ? ' — said they are not looking' : ''}`}
                          className={cn(
                            'inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-semibold',
                            t.looking === false ? 'bg-warn-bg text-warn' : 'bg-good-bg text-good',
                          )}
                        >
                          <ClipboardCheck className="size-2.5" aria-hidden />
                          {t.looking === false ? 'not looking' : 'form'}
                        </span>
                      )}
                    </span>
                    <input defaultValue={t.email ?? ''} placeholder="email" onBlur={(e) => e.target.value.trim() !== (t.email ?? '') && save(t.id, { email: e.target.value.trim() || null })} className={`${cell} text-xs text-muted`} />
                  </td>
                  <td className="border-b border-border-subtle px-2 py-1.5 whitespace-nowrap">
                    <input key={`${t.id}:${t.phone}`} defaultValue={t.phone ? formatPhone(t.phone) : ''} placeholder="(602) 555-0100" onBlur={(e) => { const v = e.target.value.trim(); if (v !== (t.phone ? formatPhone(t.phone) : '')) save(t.id, { phone: v || null }) }} className={`${cell} tnum w-36`} />
                    {t.phone && <a href={`tel:${t.phone}`} className="block px-1 text-xs text-muted hover:text-accent">call</a>}
                  </td>
                  <td className="border-b border-border-subtle px-2 py-1.5 whitespace-nowrap">
                    <input defaultValue={[t.city, t.state].filter(Boolean).join(', ')} placeholder="City, ST" onBlur={(e) => { const [c, s] = e.target.value.split(',').map((x) => x.trim()); if (c !== (t.city ?? '') || (s ?? '') !== (t.state ?? '')) save(t.id, { city: c || null, state: s ? s.slice(0, 2) : null }) }} className={`${cell} w-36`} />
                  </td>
                  <td className="border-b border-border-subtle px-2 py-1.5">
                    <input defaultValue={t.title ?? ''} placeholder="Role" onBlur={(e) => e.target.value.trim() !== (t.title ?? '') && save(t.id, { title: e.target.value.trim() || null })} className={`${cell} w-44`} />
                    <input defaultValue={t.employer ?? ''} placeholder="Employer" onBlur={(e) => e.target.value.trim() !== (t.employer ?? '') && save(t.id, { employer: e.target.value.trim() || null })} className={`${cell} w-44 text-xs text-muted`} />
                  </td>
                  <td className="border-b border-border-subtle px-2 py-1.5">
                    <textarea defaultValue={t.experience ?? ''} rows={2} placeholder="Earlier roles, years, certs" onBlur={(e) => e.target.value.trim() !== (t.experience ?? '') && save(t.id, { experience: e.target.value.trim() || null })} className={`${cell} w-64 resize-y text-xs`} />
                  </td>
                  <td className="tnum border-b border-border-subtle px-2 py-1.5 whitespace-nowrap">
                    <input type="date" defaultValue={t.next_follow_up ?? ''} onChange={(e) => save(t.id, { next_follow_up: e.target.value || null })} className={`${cell} tnum ${t.next_follow_up && t.next_follow_up <= new Date().toISOString().slice(0, 10) && !['placed', 'rejected', 'new', 'reviewing'].includes(t.status) ? 'font-medium text-bad' : ''}`} />
                    <span className="block px-1 text-xs text-muted">{t.source ?? ''}{t.applied_at ? ` · applied ${t.applied_at}` : ''}</span>
                  </td>
                  <td className="border-b border-border-subtle px-2 py-1.5 whitespace-nowrap">
                    <select value={t.status} onChange={(e) => save(t.id, { status: e.target.value })} className={`${cell} cursor-pointer`}>
                      {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    <Badge tone={STATUSES.find((s) => s.value === t.status)?.tone ?? 'neutral'} className="ml-1">{STATUSES.find((s) => s.value === t.status)?.label}</Badge>
                  </td>
                  <td className="border-b border-border-subtle px-2 py-1.5 whitespace-nowrap">
                    <select value={t.placed_company_id ?? ''} onChange={(e) => save(t.id, { placed_company_id: e.target.value || null, ...(e.target.value ? { status: 'placed' } : {}) })} className={`${cell} max-w-44 cursor-pointer truncate`}>
                      <option value="">—</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td className="border-b border-border-subtle px-2 py-1.5 whitespace-nowrap">
                    <select value={t.owner_id ?? ''} onChange={(e) => save(t.id, { owner_id: e.target.value || null })} className={`${cell} cursor-pointer`}>
                      <option value="">—</option>
                      {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                  </td>
                  <td className="border-b border-border-subtle px-2 py-1.5">
                    <button type="button" onClick={() => remove(t)} aria-label="Delete" className="cursor-pointer rounded p-1 text-muted-2 opacity-0 group-hover:opacity-100 hover:bg-bad-bg hover:text-bad">
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && <AddTech onClose={() => setAdding(false)} onSaved={() => { setAdding(false); router.refresh() }} />}
      {importing && <ImportTechs onClose={() => setImporting(false)} onDone={() => router.refresh()} />}
    </>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-lg border border-border-subtle bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="cursor-pointer text-muted hover:text-foreground"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function AddTech({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const field = 'h-8 w-full rounded-md border border-border-strong bg-background px-2 text-sm'
  return (
    <Modal title="Add tech" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const v = (k: string) => (String(f.get(k) ?? '').trim() || null)
          startTransition(async () => {
            const res = await createTech({ name: v('name'), phone: v('phone'), email: v('email'), city: v('city'), state: v('state'), title: v('title'), employer: v('employer'), experience: v('experience'), source: v('source') ?? 'Manual', notes: v('notes') ?? '' })
            setErr(res.error)
            if (!res.error) onSaved()
          })
        }}
        className="grid gap-3 p-4 sm:grid-cols-2"
      >
        <label className="flex flex-col gap-1 text-xs text-muted">Name<input name="name" required className={field} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Phone<input name="phone" type="tel" className={field} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Email<input name="email" type="email" className={field} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Source<input name="source" placeholder="Indeed, referral…" className={field} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">City<input name="city" className={field} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">State<input name="state" maxLength={2} placeholder="AZ" className={field} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Current role<input name="title" className={field} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Employer<input name="employer" className={field} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">Experience<textarea name="experience" rows={2} className="w-full rounded-md border border-border-strong bg-background p-2 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">Notes<textarea name="notes" rows={2} className="w-full rounded-md border border-border-strong bg-background p-2 text-sm" /></label>
        {err && <p className="text-xs text-bad sm:col-span-2">{err}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending}>{pending ? 'Saving…' : 'Add'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function ImportTechs({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ inserted: number; skipped: number; errors: string[] } | null>(null)
  return (
    <Modal title="Import techs from CSV" onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted">Columns: name, phone, email, city, state, title, employer, experience, source, applied (YYYY-MM-DD), notes. Only name or phone is required. Techs whose phone already exists are skipped.</p>
        <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()) }} className="text-xs file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border-strong file:bg-background file:px-2 file:py-1 file:text-xs" />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="name,phone,city,state,title&#10;Jane Doe,(602) 555-0100,Phoenix,AZ,HVAC Technician" className="w-full rounded-md border border-border-strong p-2 font-mono text-xs" />
        {result && (
          <div className="rounded-md border border-border-subtle bg-surface p-2.5 text-xs">
            <p className="text-good">Added {result.inserted}, skipped {result.skipped}.</p>
            {result.errors.slice(0, 10).map((e) => <p key={e} className="text-muted">{e}</p>)}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{result ? 'Done' : 'Cancel'}</Button>
          <Button variant="primary" disabled={pending || !text.trim()} onClick={() => startTransition(async () => { const r = await importTechs(text); setResult(r); onDone() })}>{pending ? 'Importing…' : 'Import'}</Button>
        </div>
      </div>
    </Modal>
  )
}
