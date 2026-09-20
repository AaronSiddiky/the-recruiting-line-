'use client'

import { useState } from 'react'
import { History, Pencil } from 'lucide-react'
import { formatDuration } from '@/lib/utils'

export type PriorCall = {
  id: string
  started_at: string
  outcome: string | null
  notes: string | null
  duration_seconds: number | null
  agent: { full_name: string } | null
}

const when = (iso: string) => {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return days === 0 ? `today, ${date}` : days === 1 ? `yesterday, ${date}` : `${days} days ago, ${date}`
}

/**
 * What was said last time, at the top of the exit interview.
 *
 * A second call to the same person should start from the first one: the rep
 * sees the previous disposition and notes, and can correct them in place
 * rather than writing a fresh form that contradicts the old one.
 */
export function PreviousCalls({
  calls,
  labelFor,
  outcomes,
}: {
  calls: PriorCall[]
  labelFor: (outcome: string | null) => string
  /** [value, label] pairs offered when correcting an old call. */
  outcomes: [string, string][]
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [outcome, setOutcome] = useState('')
  const [notes, setNotes] = useState('')
  const [saved, setSaved] = useState<Record<string, { outcome: string | null; notes: string | null }>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (calls.length === 0) return null

  function startEdit(c: PriorCall) {
    const current = saved[c.id] ?? c
    setEditing(c.id)
    setOutcome(current.outcome ?? '')
    setNotes(current.notes ?? '')
    setError(null)
  }

  async function save(id: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/calls/${id}/amend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: outcome || undefined, notes: notes.trim() || null }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not save.')
      setSaved((s) => ({ ...s, [id]: { outcome: outcome || null, notes: notes.trim() || null } }))
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-md border border-warn-bg bg-warn-bg/40 p-3">
      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-warn">
        <History className="size-3.5" aria-hidden />
        You have spoken to them before · {calls.length} earlier {calls.length === 1 ? 'call' : 'calls'}
      </p>
      <ul className="mt-2 space-y-2">
        {calls.map((c) => {
          const shown = saved[c.id] ?? c
          return (
            <li key={c.id} className="text-xs">
              {editing === c.id ? (
                <div className="space-y-1.5">
                  <select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome" className="h-7 w-full rounded border border-border-strong bg-background px-1.5 text-xs">
                    <option value="">No outcome</option>
                    {outcomes.map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded border border-border-strong bg-background p-1.5 text-xs" />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void save(c.id)} disabled={busy} className="cursor-pointer rounded bg-foreground px-2 py-1 text-xs font-medium text-background disabled:opacity-50">
                      {busy ? 'Saving…' : 'Save changes'}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="cursor-pointer px-1 text-xs text-muted hover:text-foreground">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{when(c.started_at)}</span>
                    {c.duration_seconds ? <span className="text-muted"> · {formatDuration(c.duration_seconds)}</span> : null}
                    {c.agent?.full_name ? <span className="text-muted"> · {c.agent.full_name}</span> : null}
                    <span className="block">
                      <span className="font-medium">{labelFor(shown.outcome)}</span>
                      {shown.notes ? <span className="text-muted"> — {shown.notes}</span> : null}
                    </span>
                  </span>
                  <button type="button" onClick={() => startEdit(c)} title="Correct this call" aria-label="Correct this call" className="shrink-0 cursor-pointer rounded p-1 text-muted hover:text-foreground">
                    <Pencil className="size-3" aria-hidden />
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {error && <p className="mt-1.5 text-xs text-bad">{error}</p>}
    </section>
  )
}
