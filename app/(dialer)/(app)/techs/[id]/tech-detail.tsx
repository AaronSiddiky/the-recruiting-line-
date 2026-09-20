'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarClock, Mail, MapPin, Phone, Send, Star, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { addTechTouch, deleteTechTouch, presentTech, setPresentationStatus, updateTech } from '@/lib/actions/techs'
import { formatPhone } from '@/lib/utils'
import { CopyScreenLink } from './copy-screen-link'
import type { Match } from '@/lib/techs/match'
import type { PresentationStatus, Tech, TechPresentation, TechStatus, TechTouchpoint, TouchChannel } from '@/types/db'

export const STAGES: { value: TechStatus; label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }[] = [
  { value: 'new', label: 'New', tone: 'neutral' },
  { value: 'reviewing', label: 'Reviewing', tone: 'neutral' },
  { value: 'contacting', label: 'Contacting', tone: 'neutral' },
  { value: 'screened', label: 'Screened', tone: 'warn' },
  { value: 'interviewing', label: 'Tech interview', tone: 'warn' },
  { value: 'presented', label: 'Presented', tone: 'warn' },
  { value: 'placed', label: 'Placed', tone: 'good' },
  { value: 'rejected', label: 'Rejected', tone: 'bad' },
]
const PRES: { value: PresentationStatus; label: string }[] = [
  { value: 'proposed', label: 'Proposed' },
  { value: 'presented', label: 'Presented' },
  { value: 'interviewing', label: 'Client interview' },
  { value: 'hired', label: 'Hired' },
  { value: 'declined', label: 'Declined' },
]
const CHANNELS: { value: TouchChannel; label: string }[] = [
  { value: 'call', label: 'Call' },
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'other', label: 'Other' },
]
type Touch = TechTouchpoint & { author: { full_name: string } | null }

const today = () => new Date().toISOString().slice(0, 10)
const localInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function TechDetail({
  tech,
  matches,
  touchpoints,
  presentations,
  calls,
  callCount,
  screenUrl,
}: {
  tech: Tech
  matches: Match[]
  touchpoints: Touch[]
  presentations: TechPresentation[]
  /** Signed link to the screening form, for texting them. */
  screenUrl?: string
  /** Their call history, with recordings and AI summaries. */
  calls?: React.ReactNode
  callCount?: number
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  function save(patch: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateTech(tech.id, patch)
      setError(res.error)
      router.refresh()
    })
  }
  const field = 'h-8 w-full rounded-md border border-border-strong bg-background px-2 text-sm'
  const due = tech.next_follow_up && tech.next_follow_up <= today()
  const presByClient = new Map(presentations.map((p) => [p.client_id, p]))
  const stage = STAGES.find((s) => s.value === tech.status)

  return (
    <div>
      {/* Header */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{tech.name ?? 'Unnamed applicant'}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            {(tech.city || tech.state) && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{[tech.city, tech.state].filter(Boolean).join(', ')}</span>}
            {tech.phone && <a href={`tel:${tech.phone}`} className="tnum inline-flex items-center gap-1 hover:text-foreground"><Phone className="size-3.5" aria-hidden />{formatPhone(tech.phone)}</a>}
            {tech.email && <a href={`mailto:${tech.email}`} className="inline-flex items-center gap-1 hover:text-foreground"><Mail className="size-3.5" aria-hidden />{tech.email}</a>}
          </div>
          <p className="mt-1 text-sm">{[tech.title, tech.employer].filter(Boolean).join(' at ')}</p>
          {tech.referred_by && (
            <p className="mt-0.5 text-xs text-muted">
              Referred by {tech.referred_by_tech_id ? <Link href={`/techs/${tech.referred_by_tech_id}`} className="underline hover:text-foreground">{tech.referred_by}</Link> : tech.referred_by}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <select value={tech.status} onChange={(e) => save({ status: e.target.value })} aria-label="Stage" className="h-8 rounded-md border border-border-strong bg-background px-2 text-sm">
              {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {stage && <Badge tone={stage.tone}>{stage.label}</Badge>}
          </div>
          <span className={`tnum text-xs ${due ? 'font-medium text-bad' : 'text-muted'}`}>
            {tech.next_follow_up ? `Next touch ${tech.next_follow_up}${due ? ' · due' : ''}` : 'No touch scheduled'}
          </span>
          <Stars value={tech.rating} onChange={(r) => save({ rating: r })} />
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-bad">Could not save: {error}</p>}

      {/* Screening card */}
      <h2 className="mt-7 mb-2 flex flex-wrap items-center gap-3 text-sm font-semibold">
        Screening
        {tech.screening_at ? (
          <span className="text-xs font-normal text-good">
            Form returned {new Date(tech.screening_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            {tech.looking === false ? ' · said they are not looking right now' : ''}
          </span>
        ) : (
          <span className="text-xs font-normal text-muted">Form not returned yet</span>
        )}
      </h2>
      {screenUrl && <div className="mb-3"><CopyScreenLink url={screenUrl} firstName={(tech.name ?? '').split(' ')[0]} /></div>}
      <section className="grid gap-3 rounded-lg border border-border-subtle p-4 sm:grid-cols-4">
        <Num label="Years in HVAC" value={tech.years_hvac} step={0.5} onSave={(v) => save({ years_hvac: v })} cls={field} />
        <Sel label="Install or service" value={tech.role_pref} options={[['install', 'Install'], ['service', 'Service'], ['both', 'Both']]} onSave={(v) => save({ role_pref: v })} cls={field} />
        <Sel label="EPA cert" value={tech.epa_cert} options={[['none', 'None'], ['type1', 'Type I'], ['type2', 'Type II'], ['type3', 'Type III'], ['universal', 'Universal']]} onSave={(v) => save({ epa_cert: v })} cls={field} />
        <Num label="Needs at least ($/hr)" value={tech.pay_min} onSave={(v) => save({ pay_min: v })} cls={field} />
        <YesNo label="Own tools" value={tech.own_tools} onSave={(v) => save({ own_tools: v })} cls={field} />
        <YesNo label="Driver's license" value={tech.drivers_license} onSave={(v) => save({ drivers_license: v })} cls={field} />
        <YesNo label="OK with commission" value={tech.commission_ok} onSave={(v) => save({ commission_ok: v })} cls={field} />
        <Num label="Max commute (mi)" value={tech.max_commute_miles} onSave={(v) => save({ max_commute_miles: v })} cls={field} />
        <label className="flex flex-col gap-1 text-xs text-muted">Can start
          <input type="date" defaultValue={tech.available_from ?? ''} onChange={(e) => save({ available_from: e.target.value || null })} className={`${field} tnum`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">Doing now
          <input defaultValue={tech.current_job ?? ''} placeholder="HVAC tech at Acme Air" onBlur={(e) => e.target.value.trim() !== (tech.current_job ?? '') && save({ current_job: e.target.value.trim() || null })} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">Experience
          <textarea defaultValue={tech.experience ?? ''} rows={2} onBlur={(e) => e.target.value.trim() !== (tech.experience ?? '') && save({ experience: e.target.value.trim() || null })} className="w-full rounded-md border border-border-strong bg-background p-2 text-sm" />
        </label>
      </section>

      {/* Tech interview */}
      <h2 className="mt-7 mb-2 flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4 text-muted" aria-hidden />Tech interview</h2>
      <section className="grid gap-3 rounded-lg border border-border-subtle p-4 sm:grid-cols-[220px_1fr]">
        <label className="flex flex-col gap-1 text-xs text-muted">When
          <input type="datetime-local" defaultValue={localInput(tech.interview_at)} onChange={(e) => save({ interview_at: e.target.value ? new Date(e.target.value).toISOString() : null, ...(e.target.value && ['new', 'reviewing', 'contacting', 'screened'].includes(tech.status) ? { status: 'interviewing' } : {}) })} className={`${field} tnum`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">Interview notes
          <textarea defaultValue={tech.interview_notes ?? ''} rows={2} placeholder="How they came across, what they know, red flags" onBlur={(e) => e.target.value.trim() !== (tech.interview_notes ?? '') && save({ interview_notes: e.target.value.trim() || null })} className="w-full rounded-md border border-border-strong bg-background p-2 text-sm" />
        </label>
        {tech.status !== 'interviewing' && !tech.interview_at && (
          <div className="sm:col-span-2"><Button onClick={() => save({ status: 'interviewing' })}>Move to Tech interview</Button></div>
        )}
      </section>

      {/* Matches */}
      <h2 className="mt-7 mb-2 text-sm font-semibold">Best-matching clients</h2>
      {matches.length === 0 ? (
        <p className="text-sm text-muted">No active clients yet.</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border-subtle">
          {matches.map((m, i) => {
            const pres = presByClient.get(m.client.id)
            return (
              <li key={m.client.id} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${i ? 'border-t border-border-subtle' : ''}`}>
                <span className={`tnum w-10 shrink-0 text-center text-lg font-semibold ${m.blocker ? 'text-bad' : m.score >= 70 ? 'text-good' : 'text-warn'}`}>{m.score}</span>
                <div className="min-w-0 flex-1">
                  <Link href={`/clients/${m.client.id}`} className="font-medium hover:underline">{m.client.company?.name ?? 'Client'}</Link>
                  <span className="ml-2 text-xs text-muted">{m.client.company?.city ?? ''}{m.client.openings ? ` · ${m.client.openings} opening${m.client.openings === 1 ? '' : 's'}` : ''}</span>
                  <p className="text-xs">
                    {m.good.map((g) => <span key={g} className="mr-2 text-good">✓ {g}</span>)}
                    {m.concerns.map((c) => <span key={c} className="mr-2 text-bad">✕ {c}</span>)}
                  </p>
                </div>
                {pres ? (
                  <select value={pres.status} onChange={(e) => startTransition(async () => { await setPresentationStatus(pres.id, tech.id, e.target.value as PresentationStatus); router.refresh() })} className="h-8 rounded-md border border-border-strong bg-background px-2 text-sm">
                    {PRES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                ) : (
                  <Button onClick={() => startTransition(async () => { const r = await presentTech(tech.id, m.client.id, m.score); setError(r.error); router.refresh() })} disabled={m.blocker} title={m.blocker ? 'A requirement is not met' : undefined}>
                    <Send className="size-3.5" aria-hidden />Present
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-1.5 text-xs text-muted">Score out of 100 from distance, install vs service, tools, commission, experience, EPA and pay. Blank screening answers count as half. Fill the screening card to sharpen it.</p>

      {/* Calls */}
      {calls && (
        <>
          <h2 className="mt-7 mb-2 text-sm font-semibold">
            Calls <span className="tnum ml-2 font-normal text-muted-2">{callCount ?? 0}</span>
            <span className="ml-2 text-xs font-normal text-muted">expand one to play the recording and read the AI summary</span>
          </h2>
          {calls}
        </>
      )}

      {/* Touch points */}
      <h2 className="mt-7 mb-2 text-sm font-semibold">Touch points <span className="tnum ml-2 font-normal text-muted-2">{touchpoints.length}</span></h2>
      <TouchForm techId={tech.id} onSaved={() => router.refresh()} />
      <ol className="mt-3 overflow-hidden rounded-lg border border-border-subtle">
        {touchpoints.length === 0 && <li className="px-4 py-5 text-center text-sm text-muted">No touches yet. Calls from the dialer are logged here automatically.</li>}
        {touchpoints.map((t, i) => (
          <li key={t.id} className={`flex items-start gap-3 px-3 py-2 text-sm ${i ? 'border-t border-border-subtle' : ''}`}>
            <span className="tnum w-32 shrink-0">{new Date(t.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}<span className="ml-1.5 text-muted-2">{new Date(t.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span></span>
            <Badge>{CHANNELS.find((c) => c.value === t.channel)?.label ?? t.channel}</Badge>
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{t.summary}</span>
            <span className="shrink-0 text-xs text-muted-2">{t.author?.full_name ?? ''}</span>
            <button type="button" onClick={() => window.confirm('Delete this touch point?') && startTransition(async () => { await deleteTechTouch(t.id, tech.id); router.refresh() })} aria-label="Delete" className="cursor-pointer rounded p-1 text-muted-2 hover:bg-bad-bg hover:text-bad"><Trash2 className="size-3.5" aria-hidden /></button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Stars({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <span className="flex items-center gap-0.5" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(value === n ? null : n)} aria-label={`${n} star${n === 1 ? '' : 's'}`} className="cursor-pointer text-warn">
          <Star className="size-4" fill={value != null && n <= value ? 'currentColor' : 'none'} aria-hidden />
        </button>
      ))}
    </span>
  )
}

function Num({ label, value, step = 1, onSave, cls }: { label: string; value: number | null; step?: number; onSave: (v: number | null) => void; cls: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">{label}
      <input type="number" min={0} step={step} defaultValue={value ?? ''} onBlur={(e) => { const v = e.target.value.trim(); const n = v === '' ? null : Number(v); if (n !== value) onSave(n) }} className={`${cls} tnum`} />
    </label>
  )
}

function Sel({ label, value, options, onSave, cls }: { label: string; value: string | null; options: [string, string][]; onSave: (v: string | null) => void; cls: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">{label}
      <select value={value ?? ''} onChange={(e) => onSave(e.target.value || null)} className={cls}>
        <option value="">—</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

function YesNo({ label, value, onSave, cls }: { label: string; value: boolean | null; onSave: (v: boolean | null) => void; cls: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">{label}
      <select value={value == null ? '' : value ? 'yes' : 'no'} onChange={(e) => onSave(e.target.value === '' ? null : e.target.value === 'yes')} className={cls}>
        <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
      </select>
    </label>
  )
}

function TouchForm({ techId, onSaved }: { techId: string; onSaved: () => void }) {
  const [pending, startTransition] = useTransition()
  const [channel, setChannel] = useState<TouchChannel>('call')
  const [summary, setSummary] = useState('')
  const [next, setNext] = useState('')
  const [err, setErr] = useState<string | null>(null)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          const r = await addTechTouch(techId, { channel, summary: summary.trim(), next_touch: next || null })
          setErr(r.error)
          if (!r.error) { setSummary(''); setNext(''); onSaved() }
        })
      }}
      className="grid gap-2 rounded-lg border border-border-subtle bg-surface p-3 sm:grid-cols-[auto_1fr_auto_auto]"
    >
      <select value={channel} onChange={(e) => setChannel(e.target.value as TouchChannel)} aria-label="Channel" className="h-8 rounded-md border border-border-strong bg-background px-2 text-sm">
        {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What happened? e.g. Texted about Grand Canyon, he's interested" required className="h-8 min-w-0 rounded-md border border-border-strong bg-background px-2 text-sm" />
      <label className="flex items-center gap-1.5 text-xs text-muted" title="Leave blank for one week from now">Next touch<input type="date" value={next} onChange={(e) => setNext(e.target.value)} className="tnum h-8 rounded-md border border-border-strong bg-background px-2 text-sm" /></label>
      <Button type="submit" variant="primary" disabled={pending || !summary.trim()}>{pending ? 'Saving…' : 'Log'}</Button>
      {err && <p className="text-xs text-bad sm:col-span-4">{err}</p>}
      <p className="text-xs text-muted-2 sm:col-span-4">Next touch defaults to one week out. Due techs come back in the dialer&rsquo;s tech queue by themselves.</p>
    </form>
  )
}
