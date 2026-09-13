'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Sparkles, Loader2 } from 'lucide-react'
import { OutcomeBadge, StatusBadge } from '@/components/ui/badge'
import { cn, formatDuration } from '@/lib/utils'
import type { Call, Profile } from '@/types/db'

export type CallRow = Call & {
  agent: Pick<Profile, 'id' | 'full_name'> | null
  company?: { id: string; name: string } | null
}

export function CallHistory({
  calls,
  showCompany = false,
}: {
  calls: CallRow[]
  showCompany?: boolean
}) {
  if (calls.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center">
        <p className="text-sm text-muted">No calls yet.</p>
      </div>
    )
  }

  return (
    <ol className="overflow-hidden rounded-lg border border-border-subtle">
      {calls.map((call, i) => (
        <CallEntry key={call.id} call={call} first={i === 0} showCompany={showCompany} />
      ))}
    </ol>
  )
}

function CallEntry({
  call,
  first,
  showCompany,
}: {
  call: CallRow
  first: boolean
  showCompany: boolean
}) {
  const [open, setOpen] = useState(first && call.status === 'connected')
  const summary = call.ai_summary
  const started = new Date(call.started_at)

  return (
    <li className={cn(!first && 'border-t border-border-subtle')}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-surface"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-2" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-2" aria-hidden />
        )}

        <span className="tnum w-36 shrink-0 text-sm">
          {started.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          <span className="ml-1.5 text-muted-2">
            {started.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
        </span>

        <StatusBadge status={call.status} />

        {showCompany && (
          <span className="w-44 shrink-0 truncate text-sm">
            {call.company ? (
              <Link
                href={`/companies/${call.company.id}`}
                onClick={(e) => e.stopPropagation()}
                className="hover:underline"
              >
                {call.company.name}
              </Link>
            ) : (
              <span className="text-muted-2">—</span>
            )}
          </span>
        )}

        <span className="tnum w-12 shrink-0 text-xs text-muted">
          {formatDuration(call.duration_seconds)}
        </span>

        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {summary?.headline ?? call.notes ?? ''}
        </span>

        <span className="shrink-0 text-xs text-muted-2">
          {call.agent?.full_name ?? ''}
        </span>

        <OutcomeBadge outcome={call.outcome} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border-subtle bg-surface px-3 py-3 pl-9">
          {call.recording_path ? (
            <audio
              controls
              preload="none"
              src={`/api/recordings/${call.id}`}
              className="h-9 w-full max-w-lg"
            >
              Your browser cannot play this recording.
            </audio>
          ) : (
            <p className="text-xs text-muted-2">
              {call.status === 'connected'
                ? 'Recording still processing.'
                : 'No recording for this call.'}
            </p>
          )}

          {call.notes && (
            <Section title="Your notes">
              <p className="whitespace-pre-wrap">{call.notes}</p>
            </Section>
          )}

          <AiPanel call={call} />
        </div>
      )}
    </li>
  )
}

function AiPanel({ call }: { call: CallRow }) {
  if (call.ai_status === 'none') return null

  if (call.ai_status === 'pending' || call.ai_status === 'processing') {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-muted">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        Transcribing and summarizing…
      </p>
    )
  }

  if (call.ai_status === 'failed') {
    return (
      <p className="text-xs text-bad">
        Summary failed{call.ai_error ? `: ${call.ai_error}` : '.'}
      </p>
    )
  }

  const s = call.ai_summary
  if (!s) return null

  return (
    <div className="rounded-md border border-border-subtle bg-background p-3">
      <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted">
        <Sparkles className="size-3" aria-hidden />
        AI summary
      </p>

      <p className="text-sm font-medium">{s.headline}</p>
      <p className="mt-1 text-sm whitespace-pre-wrap text-muted">{s.summary}</p>

      {s.objections?.length > 0 && (
        <Section title="Objections">
          <ul className="list-disc space-y-0.5 pl-4">
            {s.objections.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </Section>
      )}

      {s.commitments?.length > 0 && (
        <Section title="Commitments">
          <ul className="list-disc space-y-0.5 pl-4">
            {s.commitments.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Section>
      )}

      {s.next_step && (
        <Section title="Next step">
          <p>{s.next_step}</p>
        </Section>
      )}

      {call.transcript && <Transcript text={call.transcript} />}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-medium text-muted">{title}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function Transcript({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer text-xs font-medium text-muted hover:text-foreground"
      >
        {open ? 'Hide' : 'Show'} full transcript
      </button>
      {open && (
        <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-border-subtle bg-surface p-2.5 font-mono text-xs whitespace-pre-wrap">
          {text}
        </pre>
      )}
    </div>
  )
}
