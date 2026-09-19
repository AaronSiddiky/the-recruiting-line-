'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileText, Mail, MapPin, Phone, Trash2, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { addTouchpoint, deleteClient, deleteTouchpoint, updateClient } from '@/lib/actions/clients'
import { formatPhone } from '@/lib/utils'
import type { Client, ClientTouchpoint, Profile, TouchChannel } from '@/types/db'

type Company = { id: string; name: string; phone: string | null; email: string | null; city: string | null; state: string | null }
type Touch = ClientTouchpoint & { author: { id: string; full_name: string } | null }

const CHANNELS: { value: TouchChannel; label: string }[] = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'text', label: 'Text' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'other', label: 'Other' },
]
const STATUS_TONE = { active: 'good', paused: 'warn', ended: 'neutral' } as const

function localDateTime(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function ClientDetail({ client, profiles, touchpoints }: { client: Client & { company: Company | null }; profiles: Pick<Profile, 'id' | 'full_name'>[]; touchpoints: Touch[] }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save(patch: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateClient(client.id, patch)
      setError(res.error)
      router.refresh()
    })
  }

  const field = 'h-8 w-full rounded-md border border-border-strong bg-background px-2 text-sm focus:outline-2 focus:outline-accent'
  const area = 'w-full resize-y rounded-md border border-border-strong bg-background p-2 text-sm focus:outline-2 focus:outline-accent'
  const c = client.company
  const today = new Date().toISOString().slice(0, 10)
  const nextDue = touchpoints.map((t) => t.next_follow_up).filter((d): d is string => !!d).sort()[0]

  return (
    <div>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{c?.name ?? 'Unknown company'}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            {(c?.city || c?.state) && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{[c?.city, c?.state].filter(Boolean).join(', ')}</span>}
            {c?.phone && <span className="tnum inline-flex items-center gap-1"><Phone className="size-3.5" aria-hidden />{formatPhone(c.phone)}</span>}
            {c?.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-foreground"><Mail className="size-3.5" aria-hidden />{c.email}</a>}
            {c && <Link href={`/companies/${c.id}`} className="underline hover:text-foreground">Company record</Link>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={STATUS_TONE[client.status]}>{client.status}</Badge>
          {nextDue && <span className={`tnum text-xs ${nextDue <= today ? 'font-medium text-bad' : 'text-muted'}`}>Next follow-up {nextDue}</span>}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-4">
        <Stat label="Fee per hire" value={client.fee_cents != null ? `$${(client.fee_cents / 100).toLocaleString()}` : '—'} />
        <Stat label="Guarantee" value={client.guarantee_days != null ? `${client.guarantee_days} days` : '—'} />
        <Stat label="Signed" value={client.signed_at ?? '—'} />
        <Stat label="Won by" value={profiles.find((p) => p.id === client.won_by)?.full_name ?? '—'} />
      </dl>

      {/* Account */}
      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1"><span className="text-xs font-medium text-muted">Status</span>
          <select defaultValue={client.status} onChange={(e) => save({ status: e.target.value })} className={field}>
            <option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option>
          </select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-xs font-medium text-muted">Won by</span>
          <select defaultValue={client.won_by ?? ''} onChange={(e) => save({ won_by: e.target.value || null })} className={field}>
            <option value="">—</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-xs font-medium text-muted">Signed on</span>
          <input type="date" defaultValue={client.signed_at ?? ''} onChange={(e) => save({ signed_at: e.target.value || null })} className={`${field} tnum`} />
        </label>
        <Text label="Contact name" value={client.contact_name} onSave={(v) => save({ contact_name: v })} cls={field} />
        <Text label="Contact title" value={client.contact_title} onSave={(v) => save({ contact_title: v })} cls={field} />
        <Text label="Contact phone" value={client.contact_phone} onSave={(v) => save({ contact_phone: v })} cls={field} />
        <Text label="Contact email" value={client.contact_email} type="email" onSave={(v) => save({ contact_email: v })} cls={field} />
      </section>

      {/* Contract */}
      <h2 className="mt-8 mb-3 text-sm font-semibold">Contract</h2>
      <section className="grid gap-4 rounded-lg border border-border-subtle p-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1"><span className="text-xs font-medium text-muted">Fee per hire ($)</span>
          <input type="number" min={0} step={1} defaultValue={client.fee_cents != null ? client.fee_cents / 100 : ''} onBlur={(e) => { const v = e.target.value.trim(); save({ fee_cents: v === '' ? null : Math.round(Number(v) * 100) }) }} className={`${field} tnum`} />
        </label>
        <label className="flex flex-col gap-1"><span className="text-xs font-medium text-muted">Guarantee (days)</span>
          <input type="number" min={0} step={1} defaultValue={client.guarantee_days ?? ''} onBlur={(e) => { const v = e.target.value.trim(); save({ guarantee_days: v === '' ? null : Number(v) }) }} className={`${field} tnum`} />
        </label>
        <Text label="Fee note" value={client.fee_note} onSave={(v) => save({ fee_note: v })} cls={field} />
        <label className="flex flex-col gap-1 sm:col-span-3"><span className="text-xs font-medium text-muted">Payment terms</span>
          <Area value={client.payment_terms} rows={2} onSave={(v) => save({ payment_terms: v })} cls={area} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-3"><span className="text-xs font-medium text-muted">Who they are hiring</span>
          <Area value={client.role_brief} rows={3} onSave={(v) => save({ role_brief: v })} cls={area} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-3"><span className="text-xs font-medium text-muted">Other terms and notes</span>
          <Area value={client.notes} rows={3} onSave={(v) => save({ notes: v ?? '' })} cls={area} />
        </label>
        <div className="sm:col-span-3"><ContractFile clientId={client.id} hasFile={!!client.contract_path} onChange={() => router.refresh()} /></div>
      </section>

      {/* Requirements (used to match techs) */}
      <h2 className="mt-8 mb-3 text-sm font-semibold">What they need in a tech <span className="ml-2 font-normal text-muted-2">used to rank techs for this client</span></h2>
      <section className="grid gap-4 rounded-lg border border-border-subtle p-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1"><span className="text-xs font-medium text-muted">Install or service</span>
          <select defaultValue={client.role_type ?? ''} onChange={(e) => save({ role_type: e.target.value || null })} className={field}>
            <option value="">—</option><option value="install">Install</option><option value="service">Service</option><option value="both">Both</option>
          </select>
        </label>
        {([['requires_own_tools', 'Own tools required'], ['commission_pay', 'Commission pay'], ['epa_required', 'EPA cert required']] as const).map(([k, l]) => (
          <label key={k} className="flex flex-col gap-1"><span className="text-xs font-medium text-muted">{l}</span>
            <select defaultValue={client[k] == null ? '' : client[k] ? 'yes' : 'no'} onChange={(e) => save({ [k]: e.target.value === '' ? null : e.target.value === 'yes' })} className={field}>
              <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </label>
        ))}
        {([['min_years', 'Min years HVAC'], ['pay_min', 'Pay from ($/hr)'], ['pay_max', 'Pay up to ($/hr)'], ['openings', 'Open seats']] as const).map(([k, l]) => (
          <label key={k} className="flex flex-col gap-1"><span className="text-xs font-medium text-muted">{l}</span>
            <input type="number" min={0} defaultValue={client[k] ?? ''} onBlur={(e) => { const v = e.target.value.trim(); save({ [k]: v === '' ? (k === 'openings' ? 0 : null) : Number(v) }) }} className={`${field} tnum`} />
          </label>
        ))}
      </section>

      {/* Touch points */}
      <h2 className="mt-8 mb-3 text-sm font-semibold">Touch points <span className="tnum ml-2 font-normal text-muted-2">{touchpoints.length}</span></h2>
      <TouchForm clientId={client.id} onSaved={() => router.refresh()} />
      <ol className="mt-4 overflow-hidden rounded-lg border border-border-subtle">
        {touchpoints.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No touch points yet. Log the first call or email above.</li>}
        {touchpoints.map((t, i) => (
          <li key={t.id} className={`flex items-start gap-3 px-3 py-2.5 ${i ? 'border-t border-border-subtle' : ''}`}>
            <span className="tnum w-36 shrink-0 text-sm">
              {new Date(t.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              <span className="ml-1.5 text-muted-2">{new Date(t.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
            </span>
            <Badge>{CHANNELS.find((ch) => ch.value === t.channel)?.label ?? t.channel}</Badge>
            <span className="min-w-0 flex-1 text-sm whitespace-pre-wrap">{t.summary}</span>
            {t.next_follow_up && <span className={`tnum shrink-0 text-xs ${t.next_follow_up <= today ? 'text-bad' : 'text-muted'}`}>follow up {t.next_follow_up}</span>}
            <span className="shrink-0 text-xs text-muted-2">{t.author?.full_name ?? ''}</span>
            <button type="button" onClick={() => { if (window.confirm('Delete this touch point?')) startTransition(async () => { await deleteTouchpoint(t.id, client.id); router.refresh() }) }} aria-label="Delete touch point" className="cursor-pointer rounded p-1 text-muted-2 hover:bg-bad-bg hover:text-bad">
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ol>

      {error && <p role="alert" className="mt-4 text-xs text-bad">Could not save: {error}</p>}

      <div className="mt-10 flex justify-end">
        <Button variant="ghost" className="text-bad hover:text-bad" onClick={() => { if (window.confirm(`Remove ${c?.name ?? 'this client'} from clients? The company stays in the CRM.`)) startTransition(async () => { await deleteClient(client.id) }) }}>
          <Trash2 className="size-3.5" aria-hidden />
          Remove client
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tnum mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  )
}

function Text({ label, value, type = 'text', onSave, cls }: { label: string; value: string | null; type?: string; onSave: (v: string | null) => void; cls: string }) {
  return (
    <label className="flex flex-col gap-1"><span className="text-xs font-medium text-muted">{label}</span>
      <input type={type} defaultValue={value ?? ''} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (value ?? '')) onSave(v || null) }} className={cls} />
    </label>
  )
}

function Area({ value, rows, onSave, cls }: { value: string | null; rows: number; onSave: (v: string | null) => void; cls: string }) {
  const [v, setV] = useState(value ?? '')
  return <textarea value={v} rows={rows} onChange={(e) => setV(e.target.value)} onBlur={() => v !== (value ?? '') && onSave(v.trim() || null)} className={cls} />
}

function ContractFile({ clientId, hasFile, onChange }: { clientId: string; hasFile: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function upload(file: File) {
    setBusy(true); setErr(null)
    const body = new FormData(); body.append('file', file)
    const res = await fetch(`/api/clients/${clientId}/contract`, { method: 'POST', body })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    setBusy(false)
    if (!res.ok) { setErr(data.error ?? 'Upload failed.'); return }
    onChange()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FileText className="size-4 text-muted" aria-hidden />
      {hasFile ? (
        <a href={`/api/clients/${clientId}/contract`} target="_blank" rel="noreferrer" className="text-sm underline hover:text-accent">Open signed contract</a>
      ) : (
        <span className="text-sm text-muted">No signed contract uploaded yet.</span>
      )}
      <Button onClick={() => ref.current?.click()} disabled={busy} className="ml-auto">
        <Upload className="size-3.5" aria-hidden />{busy ? 'Uploading…' : hasFile ? 'Replace file' : 'Upload PDF or photo'}
      </Button>
      <input ref={ref} type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} />
      {hasFile && (
        <Button variant="ghost" className="text-bad hover:text-bad" onClick={async () => { if (!window.confirm('Delete the contract file?')) return; await fetch(`/api/clients/${clientId}/contract`, { method: 'DELETE' }); onChange() }}>
          Delete file
        </Button>
      )}
      {err && <p className="w-full text-xs text-bad">{err}</p>}
    </div>
  )
}

function TouchForm({ clientId, onSaved }: { clientId: string; onSaved: () => void }) {
  const [pending, startTransition] = useTransition()
  const [channel, setChannel] = useState<TouchChannel>('call')
  const [at, setAt] = useState(() => localDateTime())
  const [summary, setSummary] = useState('')
  const [next, setNext] = useState('')
  const [err, setErr] = useState<string | null>(null)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          const res = await addTouchpoint(clientId, { at: new Date(at).toISOString(), channel, summary: summary.trim(), next_follow_up: next || null })
          setErr(res.error)
          if (!res.error) { setSummary(''); setNext(''); setAt(localDateTime()); onSaved() }
        })
      }}
      className="grid gap-2 rounded-lg border border-border-subtle bg-surface p-3 sm:grid-cols-[auto_auto_1fr_auto_auto]"
    >
      <select value={channel} onChange={(e) => setChannel(e.target.value as TouchChannel)} aria-label="Channel" className="h-8 rounded-md border border-border-strong bg-background px-2 text-sm">
        {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label="When" className="tnum h-8 rounded-md border border-border-strong bg-background px-2 text-sm" />
      <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What happened? e.g. Sent two candidates, interview Thursday" aria-label="Summary" required className="h-8 min-w-0 rounded-md border border-border-strong bg-background px-2 text-sm" />
      <label className="flex items-center gap-1.5 text-xs text-muted">Follow up<input type="date" value={next} onChange={(e) => setNext(e.target.value)} className="tnum h-8 rounded-md border border-border-strong bg-background px-2 text-sm" /></label>
      <Button type="submit" variant="primary" disabled={pending || !summary.trim()}>{pending ? 'Saving…' : 'Log'}</Button>
      {err && <p className="text-xs text-bad sm:col-span-5">{err}</p>}
    </form>
  )
}
