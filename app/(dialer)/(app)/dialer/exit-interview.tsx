'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CALL_OUTCOMES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { CallOutcome } from '@/types/db'
import type { Line } from './use-dialer'
import { formatClock } from './dialer-machine'
import { ReferralCapture } from './referral-capture'
import { PreviousCalls, type PriorCall } from './previous-calls'

const TONE_RING = {
  good: 'border-good text-good bg-good-bg',
  bad: 'border-bad text-bad bg-bad-bg',
  warn: 'border-warn text-warn bg-warn-bg',
  neutral: 'border-border-strong text-foreground bg-surface-2',
} as const

function daysFromNow(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function monthFromNow(): string {
  const date = new Date()
  date.setMonth(date.getMonth() + 1)
  return date.toISOString().slice(0, 10)
}

function defaultFollowUp(): string {
  return daysFromNow(3)
}

/**
 * The exit interview. Blocks the next batch on purpose -- a disposition typed
 * ninety seconds later, after four more numbers have rung, is a disposition
 * that gets guessed.
 *
 * Number keys pick an outcome and Enter submits, because this screen appears
 * dozens of times an hour and reaching for the mouse each time is the
 * difference between a tool people use and one they work around.
 */
export function ExitInterview({
  call,
  endedBy,
  talkSeconds,
  saveLabel = 'Save and dial next',
  defaultOutcome = null,
  onSwitchKind,
  onDone,
}: {
  call: Line
  /** Shown first: "they hung up on me" changes what goes in the notes. */
  endedBy?: 'you' | 'prospect'
  talkSeconds?: number | null
  saveLabel?: string
  /** Pre-selected, e.g. "No answer" after a voicemail drop. */
  defaultOutcome?: CallOutcome | null
  /** Turn this into a call to a technician and show that form instead. */
  onSwitchKind?: () => void
  onDone: () => void
}) {
  const [outcome, setOutcome] = useState<CallOutcome | null>(defaultOutcome)
  const [notes, setNotes] = useState('')
  const [email, setEmail] = useState('')
  const [followUp, setFollowUp] = useState(defaultFollowUp)
  const [prior, setPrior] = useState<PriorCall[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!outcome) return
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/calls/${call.callId}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome,
          notes: notes.trim() || undefined,
          nextFollowUp:
            outcome === 'call_back'
              ? followUp
              : outcome === 'no_answer'
                ? daysFromNow(1)
                : outcome === 'not_interested' || outcome === 'not_hiring'
                  ? monthFromNow()
                  : null,
          email: email.trim() || undefined,
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

  // Notes has focus by default, so a bare Enter has to stay a newline. Number
  // keys only fire when the caret is not in a text field.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing =
        event.target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA'].includes(event.target.tagName)

      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || !typing)) {
        event.preventDefault()
        void submit()
        return
      }

      if (typing) return

      const match = CALL_OUTCOMES.find((o) => o.key === event.key)
      if (match) {
        event.preventDefault()
        setOutcome(match.value)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, notes, followUp, email, saving])

  // Earlier calls to this company, so a second conversation starts informed.
  useEffect(() => {
    let stale = false
    fetch(`/api/calls/${call.callId}/context`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { previous?: PriorCall[] } | null) => {
        if (!stale && d) setPrior(d.previous ?? [])
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [call.callId])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Exit interview for ${call.companyName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-background shadow-xl">
        <div
          className={cn(
            'rounded-t-lg border-b px-5 py-3.5',
            endedBy === 'prospect' ? 'border-bad-bg bg-bad-bg' : 'border-border-subtle',
          )}
        >
          <p className={cn('text-xs font-semibold', endedBy === 'prospect' ? 'text-bad' : 'text-muted')}>
            {endedBy === 'prospect' ? 'Prospect hung up' : endedBy === 'you' ? 'You hung up' : 'Call ended'}
            {talkSeconds != null && (
              <span className="tnum font-normal"> · talked {formatClock(talkSeconds)}</span>
            )}
          </p>
          <h2 className="text-base font-semibold">{call.companyName}</h2>
          {onSwitchKind && (
            <button type="button" onClick={onSwitchKind} className="mt-0.5 cursor-pointer text-xs text-muted underline hover:text-foreground">
              This was a technician, not a company
            </button>
          )}
        </div>

        <div className="space-y-4 px-5 py-4">
          <PreviousCalls
            calls={prior}
            labelFor={(o) => CALL_OUTCOMES.find((x) => x.value === o)?.label ?? (o ? o.replace(/_/g, ' ') : 'No outcome logged')}
            outcomes={CALL_OUTCOMES.map((o) => [o.value, o.label] as [string, string])}
          />

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-muted">
              What happened?
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {CALL_OUTCOMES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setOutcome(option.value)}
                  aria-pressed={outcome === option.value}
                  className={cn(
                    'flex cursor-pointer flex-col items-start rounded-md border px-2.5 py-2 text-left transition-colors',
                    outcome === option.value
                      ? TONE_RING[option.tone]
                      : 'border-border-subtle hover:border-border-strong',
                  )}
                >
                  <span className="flex w-full items-center justify-between text-sm font-medium">
                    {option.label}
                    <kbd className="rounded bg-surface-2 px-1 text-[10px] text-muted">
                      {option.key}
                    </kbd>
                  </span>
                  <span className="mt-0.5 text-xs text-muted">{option.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {outcome === 'no_answer' && (
            <p className="text-xs text-muted">
              They go back in the queue for tomorrow. Pick “Call back” instead to choose the day.
            </p>
          )}

          {outcome === 'not_interested' && (
            <p className="text-xs text-muted">
              Not now isn’t never: they come back in the queue in one month.
            </p>
          )}

          {outcome === 'not_hiring' && (
            <p className="text-xs text-muted">
              Seats open up. They come back in the queue in one month.
            </p>
          )}

          {outcome === 'call_back' && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted">Call back on</span>
              <input
                type="date"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                className="tnum h-8 rounded-md border border-border-strong px-2 text-sm focus:outline-2 focus:outline-accent"
              />
            </label>
          )}

          <ReferralCapture fromCompanyId={call.companyId || null} />

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              autoFocus
              placeholder="Who you spoke to, what they said, anything worth knowing next time."
              className="w-full resize-y rounded-md border border-border-strong p-2 text-sm focus:outline-2 focus:outline-accent"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">
              Email
              <span className="ml-1.5 font-normal text-muted-2">if they gave you one</span>
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@company.com"
              autoComplete="off"
              className="h-8 w-full rounded-md border border-border-strong px-2 text-sm focus:outline-2 focus:outline-accent"
            />
          </label>

          <p className="inline-flex items-center gap-1.5 text-xs text-muted-2">
            <Sparkles className="size-3" aria-hidden />
            The recording and AI summary land on the company page in about a
            minute — no need to wait for them.
          </p>

          {error && (
            <p role="alert" className="text-xs text-bad">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border-subtle px-5 py-3">
          <span className="text-xs text-muted-2">
            {outcome ? 'Press \u2318\u21A9 to save' : 'Press 1\u20137 to pick an outcome'}
          </span>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!outcome || saving}
            className="h-9"
          >
            {saving ? 'Saving…' : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
