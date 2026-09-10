'use client'

import Link from 'next/link'
import { Mic, MicOff, PhoneOff, Play, SkipForward, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExitInterview } from './exit-interview'
import { DialPad } from './dial-pad'
import { useDialer, type Line } from './use-dialer'
import { cn, formatPhone } from '@/lib/utils'
import { DEFAULT_LINES_PER_BATCH, STATUS_LABELS } from '@/lib/constants'
import type { CallStatus } from '@/types/db'

export function Dialer({ queueSize }: { queueSize: number }) {
  const d = useDialer()
  const running = d.phase !== 'idle'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-2.5">
        <PhaseIndicator phase={d.phase} />

        <div className="ml-auto flex items-center gap-4">
          <span className="tnum text-xs text-muted">
            {d.stats.dialed} dialed · {d.stats.connected} connected
          </span>

          {running ? (
            <Button variant="danger" onClick={() => void d.end()}>
              <Square className="size-3.5" aria-hidden />
              End session
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void d.start()}
              disabled={queueSize === 0}
              title={queueSize === 0 ? 'No leads queued — use the dial pad below' : undefined}
            >
              <Play className="size-3.5" aria-hidden />
              Start dialing
            </Button>
          )}
        </div>
      </div>

      {d.error && (
        <div role="alert" className="border-b border-bad-bg bg-bad-bg px-4 py-2 text-sm text-bad">
          {d.error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {d.phase === 'idle' && (
          <div className="flex flex-col items-center gap-8">
            <IdleState queueSize={queueSize} />
            <DialPad
              mode="compose"
              busy={false}
              onDial={(phone) => void d.manualDial(phone)}
              onDigit={d.sendDigits}
            />
          </div>
        )}

        {d.phase === 'exhausted' && (
          <div className="flex flex-col items-center gap-8">
            <Empty
              title="Nothing left to dial."
              body="Every eligible lead has been called, is scheduled for a later follow-up, or is outside its local calling hours."
            />
            <DialPad
              mode="compose"
              busy={false}
              onDial={(phone) => void d.manualDial(phone)}
              onDigit={d.sendDigits}
            />
          </div>
        )}

        {(d.phase === 'connecting' || d.phase === 'dialing' || d.phase === 'ready') && (
          <div className="flex flex-wrap items-start justify-center gap-10">
            <LineBoard
              lines={d.lines}
              phase={d.phase}
              onSkip={() => void d.skipBatch()}
            />
            {(d.phase === 'ready' || d.phase === 'dialing') && (
              <DialPad
                mode="compose"
                busy={d.phase === 'dialing'}
                onDial={(phone) => void d.manualDial(phone)}
                onDigit={d.sendDigits}
              />
            )}
          </div>
        )}

        {d.phase === 'live' && d.liveCall && (
          <div className="flex flex-wrap items-start justify-center gap-10">
            <LiveCall
              call={d.liveCall}
              muted={d.muted}
              onMute={d.toggleMute}
              onHangUp={() => void d.hangUp()}
            />
            <DialPad
              mode="dtmf"
              busy={false}
              onDial={(phone) => void d.manualDial(phone)}
              onDigit={d.sendDigits}
            />
          </div>
        )}
      </div>

      {d.phase === 'wrapup' && d.wrapCall && (
        <ExitInterview call={d.wrapCall} onDone={() => void d.finishWrapup()} />
      )}
    </div>
  )
}

function PhaseIndicator({ phase }: { phase: string }) {
  const COPY: Record<string, { label: string; live?: boolean }> = {
    idle: { label: 'Not dialing' },
    connecting: { label: 'Connecting your microphone…' },
    ready: { label: 'Ready' },
    dialing: { label: `Dialing ${DEFAULT_LINES_PER_BATCH} lines`, live: true },
    live: { label: 'On a call', live: true },
    wrapup: { label: 'Wrapping up' },
    exhausted: { label: 'Queue empty' },
  }
  const state = COPY[phase] ?? { label: phase }

  return (
    <span className="flex items-center gap-2 text-sm font-medium">
      <span
        className={cn(
          'size-2 rounded-full',
          state.live ? 'animate-ring bg-live' : 'bg-muted-2',
        )}
        aria-hidden
      />
      {state.label}
    </span>
  )
}

function IdleState({ queueSize }: { queueSize: number }) {
  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="text-lg font-semibold tracking-tight">Parallel dialer</h1>
      <p className="mt-2 text-sm text-muted">
        {queueSize === 0 ? (
          <>
            No leads are eligible to dial right now. Import a list or clear a
            filter over on the <Link href="/crm" className="text-accent underline">CRM</Link>.
          </>
        ) : (
          <>
            {queueSize.toLocaleString()} {queueSize === 1 ? 'lead is' : 'leads are'}{' '}
            ready. Starting will open {DEFAULT_LINES_PER_BATCH} lines at once and
            connect you to whoever answers first.
          </>
        )}
      </p>
      <p className="mt-4 text-xs text-muted-2">
        Your browser will ask for microphone access the first time.
      </p>
    </div>
  )
}

const LINE_TONE: Record<CallStatus, string> = {
  dialing: 'border-border-subtle text-muted',
  ringing: 'border-warn text-warn',
  connected: 'border-good text-good',
  no_answer: 'border-border-subtle text-muted-2',
  busy: 'border-border-subtle text-muted-2',
  failed: 'border-border-subtle text-muted-2',
  voicemail: 'border-border-subtle text-muted-2',
  canceled: 'border-border-subtle text-muted-2',
}

function LineBoard({
  lines,
  phase,
  onSkip,
}: {
  lines: Line[]
  phase: string
  onSkip: () => void
}) {
  const placeholders = Math.max(0, DEFAULT_LINES_PER_BATCH - lines.length)
  const ringing = lines.some((l) => l.status === 'dialing' || l.status === 'ringing')

  return (
    <div className="mx-auto max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-2">
        {lines.map((line) => (
          <div
            key={line.callId}
            className={cn(
              'rounded-lg border bg-background px-3.5 py-3 transition-colors',
              LINE_TONE[line.status],
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {line.companyName}
              </span>
              <span className="shrink-0 text-xs whitespace-nowrap">
                {STATUS_LABELS[line.status]}
              </span>
            </div>
            <span className="tnum mt-0.5 block text-xs text-muted">
              {formatPhone(line.phone)}
            </span>
          </div>
        ))}

        {Array.from({ length: placeholders }, (_, i) => (
          <div
            key={`placeholder-${i}`}
            className="rounded-lg border border-dashed border-border-subtle px-3.5 py-3"
          >
            <span className="text-sm text-muted-2">
              {phase === 'connecting' ? 'Waiting for the conference…' : 'Open line'}
            </span>
          </div>
        ))}
      </div>

      {ringing && (
        <div className="mt-4 flex justify-center">
          <Button onClick={onSkip}>
            <SkipForward className="size-3.5" aria-hidden />
            Skip this batch
          </Button>
        </div>
      )}
    </div>
  )
}

function LiveCall({
  call,
  muted,
  onMute,
  onHangUp,
}: {
  call: Line
  muted: boolean
  onMute: () => void
  onHangUp: () => void
}) {
  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-lg border border-good bg-good-bg px-5 py-4">
        <p className="text-xs font-medium text-good">Connected</p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight">
          {call.companyName}
        </h1>
        <p className="tnum mt-0.5 text-sm text-muted">{formatPhone(call.phone)}</p>

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={onMute} aria-pressed={muted}>
            {muted ? (
              <MicOff className="size-3.5" aria-hidden />
            ) : (
              <Mic className="size-3.5" aria-hidden />
            )}
            {muted ? 'Unmute' : 'Mute'}
          </Button>

          <Button variant="danger" onClick={onHangUp}>
            <PhoneOff className="size-3.5" aria-hidden />
            Hang up
          </Button>

          <Link
            href={`/companies/${call.companyId}`}
            target="_blank"
            className="ml-auto text-xs text-muted underline hover:text-foreground"
          >
            Open company record
          </Link>
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-muted-2">
        This call is being recorded. Hanging up opens the exit interview.
      </p>
    </div>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  )
}
