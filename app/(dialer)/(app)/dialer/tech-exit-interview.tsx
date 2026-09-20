'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TECH_OUTCOMES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { EpaCert, RoleType } from '@/types/db'
import type { Line } from './use-dialer'
import { formatClock } from './dialer-machine'
import { ReferralCapture } from './referral-capture'
import { PreviousCalls, type PriorCall } from './previous-calls'
import { CopyScreenLink } from '../techs/[id]/copy-screen-link'

const TONE_RING = {
  good: 'border-good text-good bg-good-bg',
  bad: 'border-bad text-bad bg-bad-bg',
  warn: 'border-warn text-warn bg-warn-bg',
  neutral: 'border-border-strong text-foreground bg-surface-2',
} as const

const daysFromNow = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
const defaultInterview = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(10, 0, 0, 0)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * The exit interview for a call to a technician.
 *
 * A tech call asks different questions than a call to a shop: not "are you
 * hiring" but "what can you do, and when can you start". The screening row is
 * here rather than on their page because these answers are only ever fresh
 * while the rep still has them on the phone.
 */
export function TechExitInterview({
  call,
  endedBy,
  talkSeconds,
  saveLabel = 'Save and dial next',
  onSwitchKind,
  onDone,
}: {
  call: Line
  endedBy?: 'you' | 'prospect'
  talkSeconds?: number | null
  saveLabel?: string
  /** Turn this into a call to a company and show that form instead. */
  onSwitchKind?: () => void
  onDone: () => void
}) {
  const [outcome, setOutcome] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [email, setEmail] = useState('')
  const [followUp, setFollowUp] = useState(() => daysFromNow(3))
  const [interviewAt, setInterviewAt] = useState(defaultInterview)
  const [years, setYears] = useState('')
  const [rolePref, setRolePref] = useState<RoleType | ''>('')
  const [epa, setEpa] = useState<EpaCert | ''>('')
  const [tools, setTools] = useState<'' | 'yes' | 'no'>('')
  const [commission, setCommission] = useState<'' | 'yes' | 'no'>('')
  const [pay, setPay] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prior, setPrior] = useState<PriorCall[]>([])
  const [known, setKnown] = useState<{ name?: string | null; status?: string } | null>(null)
  const [screenLink, setScreenLink] = useState<string | null>(null)

  // What we already know: earlier calls, and the screening card as it stands.
  // Pre-filling it means a second call corrects what is there instead of
  // asking the same six questions again.
  useEffect(() => {
    let stale = false
    fetch(`/api/calls/${call.callId}/context`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { previous?: PriorCall[]; tech?: Record<string, unknown> | null; screenUrl?: string } | null) => {
        if (stale || !d) return
        setPrior(d.previous ?? [])
        if (d.screenUrl) setScreenLink(d.screenUrl)
        const t = d.tech
        if (!t) return
        setKnown({ name: t.name as string | null, status: t.status as string })
        if (t.years_hvac != null) setYears(String(t.years_hvac))
        if (t.role_pref) setRolePref(t.role_pref as RoleType)
        if (t.epa_cert) setEpa(t.epa_cert as EpaCert)
        if (t.own_tools != null) setTools(t.own_tools ? 'yes' : 'no')
        if (t.commission_ok != null) setCommission(t.commission_ok ? 'yes' : 'no')
        if (t.pay_min != null) setPay(String(t.pay_min))
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [call.callId])

  const chosen = TECH_OUTCOMES.find((o) => o.value === outcome) ?? null
  const screening = outcome === 'interested' || outcome === 'book_interview' || outcome === 'call_back'

  async function submit() {
    if (!chosen) return
    setSaving(true)
    setError(null)
    try {
      const tech: Record<string, unknown> = {}
      if (years.trim()) tech.years_hvac = Number(years)
      if (rolePref) tech.role_pref = rolePref
      if (epa) tech.epa_cert = epa
      if (tools) tech.own_tools = tools === 'yes'
      if (commission) tech.commission_ok = commission === 'yes'
      if (pay.trim()) tech.pay_min = Math.round(Number(pay))
      if (outcome === 'book_interview' && interviewAt) tech.interview_at = new Date(interviewAt).toISOString()
      tech.stage = chosen.stage

      const response = await fetch(`/api/calls/${call.callId}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: chosen.callOutcome,
          notes: notes.trim() || undefined,
          nextFollowUp:
            chosen.followUpDays == null
              ? outcome === 'call_back'
                ? followUp
                : null
              : daysFromNow(chosen.followUpDays),
          email: email.trim() || undefined,
          tech,
        }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? 'Could not save the outcome.')
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the outcome.')
      setSaving(false)
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || !typing)) {
        event.preventDefault()
        void submit()
        return
      }
      if (typing) return
      const match = TECH_OUTCOMES.find((o) => o.key === event.key)
      if (match) {
        event.preventDefault()
        setOutcome(match.value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, notes, followUp, email, interviewAt, years, rolePref, epa, tools, commission, pay, saving])

  const small = 'h-8 w-full rounded-md border border-border-strong bg-background px-1.5 text-sm'

  return (
    <div role="dialog" aria-modal="true" aria-label={`Call notes for ${call.companyName}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border-subtle bg-background shadow-xl">
        <div className={cn('rounded-t-lg border-b px-5 py-3.5', endedBy === 'prospect' ? 'border-bad-bg bg-bad-bg' : 'border-border-subtle')}>
          <p className={cn('text-xs font-semibold', endedBy === 'prospect' ? 'text-bad' : 'text-muted')}>
            {endedBy === 'prospect' ? 'They hung up' : endedBy === 'you' ? 'You hung up' : 'Call ended'}
            {talkSeconds != null && <span className="tnum font-normal"> · talked {formatClock(talkSeconds)}</span>}
            <span className="font-normal"> · technician{known?.status ? ` · ${known.status}` : ''}</span>
          </p>
          <h2 className="text-base font-semibold">{call.companyName}</h2>
          {onSwitchKind && (
            <button type="button" onClick={onSwitchKind} className="mt-0.5 cursor-pointer text-xs text-muted underline hover:text-foreground">
              This was a company, not a technician
            </button>
          )}
        </div>

        <div className="space-y-4 px-5 py-4">
          <PreviousCalls
            calls={prior}
            labelFor={(o) => TECH_OUTCOMES.find((x) => x.callOutcome === o)?.label ?? (o ? o.replace(/_/g, ' ') : 'No outcome logged')}
            outcomes={TECH_OUTCOMES.map((o) => [o.callOutcome, o.label] as [string, string])}
          />

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-muted">How did it go?</legend>
            <div className="grid grid-cols-2 gap-2">
              {TECH_OUTCOMES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setOutcome(option.value)}
                  aria-pressed={outcome === option.value}
                  className={cn(
                    'flex cursor-pointer flex-col items-start rounded-md border px-2.5 py-2 text-left transition-colors',
                    outcome === option.value ? TONE_RING[option.tone] : 'border-border-subtle hover:border-border-strong',
                  )}
                >
                  <span className="flex w-full items-center justify-between text-sm font-medium">
                    {option.label}
                    <kbd className="rounded bg-surface-2 px-1 text-[10px] text-muted">{option.key}</kbd>
                  </span>
                  <span className="mt-0.5 text-xs text-muted">{option.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {outcome === 'book_interview' && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted">Interview at</span>
              <input type="datetime-local" value={interviewAt} onChange={(e) => setInterviewAt(e.target.value)} className="tnum h-8 rounded-md border border-border-strong px-2 text-sm focus:outline-2 focus:outline-accent" />
            </label>
          )}

          {outcome === 'call_back' && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted">Call back on</span>
              <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="tnum h-8 rounded-md border border-border-strong px-2 text-sm focus:outline-2 focus:outline-accent" />
            </label>
          )}

          {chosen && chosen.followUpDays != null && outcome !== 'call_back' && (
            <p className="text-xs text-muted">Next touch in {chosen.followUpDays === 1 ? 'a day' : chosen.followUpDays === 7 ? 'a week' : `${chosen.followUpDays} days`}.</p>
          )}

          {screening && (
            <fieldset className="rounded-md border border-border-subtle p-3">
              <legend className="px-1 text-xs font-medium text-muted">
              Screening — {prior.length > 0 ? 'what we had, correct anything that changed' : 'fill in what they told you'}
            </legend>
              <div className="grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted">Years HVAC
                  <input type="number" min={0} step={0.5} value={years} onChange={(e) => setYears(e.target.value)} className={`${small} tnum`} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">Install / service
                  <select value={rolePref} onChange={(e) => setRolePref(e.target.value as RoleType | '')} className={small}>
                    <option value="">—</option><option value="install">Install</option><option value="service">Service</option><option value="both">Both</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">EPA
                  <select value={epa} onChange={(e) => setEpa(e.target.value as EpaCert | '')} className={small}>
                    <option value="">—</option><option value="none">None</option><option value="type1">Type I</option><option value="type2">Type II</option><option value="type3">Type III</option><option value="universal">Universal</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">Own tools
                  <select value={tools} onChange={(e) => setTools(e.target.value as '' | 'yes' | 'no')} className={small}>
                    <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">Commission OK
                  <select value={commission} onChange={(e) => setCommission(e.target.value as '' | 'yes' | 'no')} className={small}>
                    <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">Wants ($/hr)
                  <input type="number" min={0} value={pay} onChange={(e) => setPay(e.target.value)} className={`${small} tnum`} />
                </label>
              </div>
            </fieldset>
          )}

          {screenLink && (
            <div className="rounded-md border border-border-subtle bg-surface px-3 py-2">
              <p className="text-xs font-medium text-muted">Still looking? Send them the questions.</p>
              <div className="mt-1.5">
                <CopyScreenLink url={screenLink} firstName={(known?.name ?? call.companyName ?? '').split(' ')[0]} />
              </div>
            </div>
          )}

          <ReferralCapture fromTechId={call.techId ?? null} />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} autoFocus placeholder="What they do now, why they are looking, when they can start." className="w-full resize-y rounded-md border border-border-strong p-2 text-sm focus:outline-2 focus:outline-accent" />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Email <span className="ml-1.5 font-normal text-muted-2">to send the job details</span></span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tech@gmail.com" autoComplete="off" className="h-8 w-full rounded-md border border-border-strong px-2 text-sm focus:outline-2 focus:outline-accent" />
          </label>

          <p className="inline-flex items-center gap-1.5 text-xs text-muted-2">
            <Sparkles className="size-3" aria-hidden />
            This call, the recording and the AI summary land on their tech page, and the next touch is scheduled for you.
          </p>

          {error && <p role="alert" className="text-xs text-bad">{error}</p>}
        </div>

        <div className="flex items-center justify-between border-t border-border-subtle px-5 py-3">
          <span className="text-xs text-muted-2">{outcome ? 'Press ⌘↩ to save' : 'Press 1–8 to pick an outcome'}</span>
          <Button variant="primary" onClick={submit} disabled={!outcome || saving} className="h-9">
            {saving ? 'Saving…' : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
