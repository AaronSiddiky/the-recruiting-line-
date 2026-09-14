'use client'

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import Link from 'next/link'
import {
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Play,
  SkipForward,
  Square,
  TriangleAlert,
  Voicemail,
  WifiOff,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExitInterview } from './exit-interview'
import { DialPad } from './dial-pad'
import { useDialer, type AgentAudio, type AudioLevels } from './use-dialer'
import {
  describeLine,
  formatClock,
  secondsSince,
  summarizeLines,
  type DialMode,
  type DialerPhase,
  type Line,
  type LineSummary,
  type LineTone,
  type Notice,
  type SyncState,
  type WrapCall,
} from './dialer-machine'
import { cn, formatPhone } from '@/lib/utils'
import { DEFAULT_LINES_PER_BATCH } from '@/lib/constants'

export function Dialer({ queueSize }: { queueSize: number }) {
  const d = useDialer()
  const running = d.phase !== 'idle'
  const now = useNow(d.phase === 'dialing' || d.phase === 'live')

  const pad = (
    <DialPad
      mode="compose"
      busy={false}
      onDial={(phone) => void d.manualDial(phone)}
      onDigit={d.sendDigits}
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border-subtle px-4 py-2.5">
        <PhaseLabel
          phase={d.phase}
          mode={d.mode}
          lines={d.lines}
          liveLine={d.liveLine}
          wrap={d.wrap}
        />

        {d.agent.line !== 'offline' && (
          <AgentLineChip agent={d.agent} levelsRef={d.levelsRef} onToggleMute={d.toggleMute} />
        )}

        <div className="ml-auto flex items-center gap-4">
          {running && <SyncBadge sync={d.sync} />}
          <span className="tnum hidden text-xs text-muted md:inline">
            {d.stats.dialed} dialed · {d.stats.connected} connected
            {d.stats.voicemail > 0 && ` · ${d.stats.voicemail} voicemail`}
            {d.stats.dropped > 0 && ` · ${d.stats.dropped} dropped`}
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
              title={queueSize === 0 ? 'No leads queued. Use the dial pad below.' : undefined}
            >
              <Play className="size-3.5" aria-hidden />
              Start dialing
            </Button>
          )}
        </div>
      </header>

      {d.error && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b border-bad-bg bg-bad-bg px-4 py-2 text-sm text-bad"
        >
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {d.error}
        </div>
      )}
      {d.notice && <NoticeBar notice={d.notice} onDismiss={d.dismissNotice} />}

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {d.phase === 'idle' && (
          <div className="flex flex-col items-center gap-8">
            <IdleState queueSize={queueSize} />
            {pad}
          </div>
        )}

        {d.phase === 'connecting' && <ConnectingState />}

        {d.phase === 'ready' && (
          <div className="flex flex-col items-center gap-8">
            <ReadyState queueSize={queueSize} onResume={d.resumeQueue} />
            {pad}
          </div>
        )}

        {d.phase === 'exhausted' && (
          <div className="flex flex-col items-center gap-8">
            <Empty
              title="Nothing left to dial."
              body="Every eligible lead has been called, is scheduled for a later follow-up, or is outside its local calling hours."
            />
            {pad}
          </div>
        )}

        {d.phase === 'dialing' && (
          <BatchBoard
            lines={d.lines}
            mode={d.mode}
            batchNumber={d.batchNumber}
            now={now}
            onSkip={() => void d.skipBatch()}
          />
        )}

        {d.phase === 'live' && d.liveLine && (
          <LiveCallPanel
            line={d.liveLine}
            lines={d.lines}
            agent={d.agent}
            levelsRef={d.levelsRef}
            now={now}
            onMute={d.toggleMute}
            onHangUp={() => void d.hangUp()}
            onDigit={d.sendDigits}
          />
        )}

        {d.phase === 'wrapup' && (
          <BatchBoard
            lines={d.lines}
            mode={d.mode}
            batchNumber={d.batchNumber}
            now={now}
            onSkip={() => undefined}
            dimmed
          />
        )}
      </div>

      {d.phase === 'wrapup' && d.wrap && (
        <ExitInterview
          call={d.wrap}
          endedBy={d.wrap.endedBy}
          talkSeconds={d.wrap.talkSeconds}
          saveLabel={d.mode === 'manual' ? 'Save' : 'Save and dial next'}
          onDone={d.finishWrapup}
        />
      )}
    </div>
  )
}

// --- header ------------------------------------------------------------------

function PhaseLabel({
  phase,
  mode,
  lines,
  liveLine,
  wrap,
}: {
  phase: DialerPhase
  mode: DialMode
  lines: Line[]
  liveLine: Line | null
  wrap: WrapCall | null
}) {
  let label = ''
  let dot = 'bg-muted-2'
  let pulse = false

  switch (phase) {
    case 'idle':
      label = 'Not dialing'
      break
    case 'connecting':
      label = 'Opening your line…'
      dot = 'bg-warn'
      pulse = true
      break
    case 'ready':
      label = 'Line open · ready to dial'
      dot = 'bg-good'
      break
    case 'dialing':
      dot = 'bg-warn'
      pulse = true
      if (mode === 'manual') label = lines[0] ? `Calling ${lines[0].companyName}` : 'Placing call…'
      else
        label =
          lines.length > 0
            ? `Dialing ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`
            : 'Starting next batch…'
      break
    case 'live':
      label = `Live · ${liveLine?.companyName ?? 'prospect'}`
      dot = 'bg-good'
      pulse = true
      break
    case 'wrapup':
      label = wrap?.endedBy === 'prospect' ? 'Prospect hung up' : 'Call ended'
      dot = wrap?.endedBy === 'prospect' ? 'bg-bad' : 'bg-muted-2'
      break
    case 'exhausted':
      label = 'Queue empty'
      break
  }

  return (
    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
      <span className={cn('size-2.5 shrink-0 rounded-full', dot, pulse && 'animate-ring')} aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  )
}

const NETWORK_WARNINGS = new Set([
  'high-rtt',
  'low-mos',
  'high-jitter',
  'high-packet-loss',
  'ice-connectivity-lost',
])

/**
 * The agent's own line, visible in every phase. "Am I on, am I muted" should
 * never require finding a panel.
 */
function AgentLineChip({
  agent,
  levelsRef,
  onToggleMute,
}: {
  agent: AgentAudio
  levelsRef: RefObject<AudioLevels>
  onToggleMute: () => void
}) {
  const weak = agent.warnings.some((w) => NETWORK_WARNINGS.has(w))
  const silentMic = !agent.muted && agent.warnings.includes('constant-audio-input-level')

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <span
          className={cn(
            'size-2 rounded-full',
            agent.line === 'open' ? 'bg-good' : 'animate-ring bg-warn',
          )}
          aria-hidden
        />
        {agent.line === 'open'
          ? 'Your line is connected'
          : agent.line === 'reconnecting'
            ? 'Reconnecting your line…'
            : 'Connecting your line…'}
      </span>

      <button
        type="button"
        onClick={onToggleMute}
        aria-pressed={agent.muted}
        title="Toggle mute (M)"
        className={cn(
          'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors',
          agent.muted
            ? 'border-bad bg-bad text-white'
            : 'border-border-strong text-foreground hover:bg-surface-2',
        )}
      >
        {agent.muted ? <MicOff className="size-3.5" aria-hidden /> : <Mic className="size-3.5" aria-hidden />}
        {agent.muted ? 'MUTED' : 'Mic on'}
        {!agent.muted && (
          <LevelMeter levelsRef={levelsRef} channel="input" bars={4} className="text-good" />
        )}
        <Kbd>M</Kbd>
      </button>

      {weak && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-warn">
          <WifiOff className="size-3.5" aria-hidden />
          Weak connection
        </span>
      )}
      {silentMic && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-warn">
          <TriangleAlert className="size-3.5" aria-hidden />
          Your mic isn&apos;t picking up sound
        </span>
      )}
    </div>
  )
}

function SyncBadge({ sync }: { sync: SyncState }) {
  if (sync === 'live') {
    return (
      <span className="hidden items-center gap-1.5 text-xs text-muted lg:inline-flex" title="Call status is streaming in real time.">
        <span className="size-1.5 rounded-full bg-good" aria-hidden />
        Live updates
      </span>
    )
  }
  if (sync === 'polling') {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs font-medium text-warn"
        title="Real-time updates are unavailable, so call status is checked every 1.5 seconds."
      >
        <span className="size-1.5 rounded-full bg-warn" aria-hidden />
        Updating every 1.5s
      </span>
    )
  }
  if (sync === 'offline') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-bad">
        <WifiOff className="size-3.5" aria-hidden />
        Can&apos;t reach the server
      </span>
    )
  }
  return null
}

function NoticeBar({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2 border-b px-4 py-2 text-sm',
        notice.tone === 'warn' && 'border-warn-bg bg-warn-bg text-warn',
        notice.tone === 'bad' && 'border-bad-bg bg-bad-bg text-bad',
        notice.tone === 'info' && 'border-border-subtle bg-surface text-foreground',
      )}
    >
      {notice.tone === 'warn' && <Voicemail className="size-4 shrink-0" aria-hidden />}
      {notice.tone === 'bad' && <TriangleAlert className="size-4 shrink-0" aria-hidden />}
      <span className="flex-1">{notice.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="cursor-pointer opacity-60 hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

// --- idle states -------------------------------------------------------------

function IdleState({ queueSize }: { queueSize: number }) {
  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="text-lg font-semibold tracking-tight">Parallel dialer</h1>
      <p className="mt-2 text-sm text-muted">
        {queueSize === 0 ? (
          <>
            No leads are eligible to dial right now. Import a list or clear a filter over on
            the{' '}
            <Link href="/crm" className="text-accent underline">
              CRM
            </Link>
            .
          </>
        ) : (
          <>
            {queueSize.toLocaleString()} {queueSize === 1 ? 'lead is' : 'leads are'} ready.
            Starting opens {DEFAULT_LINES_PER_BATCH} lines at once, and the first person to pick
            up is connected to you with a tone.
          </>
        )}
      </p>
      <p className="mt-4 text-xs text-muted-2">
        Your browser will ask for microphone access the first time.
      </p>
    </div>
  )
}

function ConnectingState() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 pt-10 text-center">
      <Loader2 className="size-5 animate-spin text-muted" aria-hidden />
      <p className="text-sm font-medium">Opening your line</p>
      <p className="text-xs text-muted">Allow microphone access if your browser asks.</p>
    </div>
  )
}

function ReadyState({ queueSize, onResume }: { queueSize: number; onResume: () => void }) {
  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="text-lg font-semibold tracking-tight">Your line is open</h1>
      <p className="mt-2 text-sm text-muted">
        Dial a number by hand{queueSize > 0 ? ', or pick the queue back up.' : '.'}
      </p>
      {queueSize > 0 && (
        <Button variant="primary" className="mt-4" onClick={onResume}>
          <Play className="size-3.5" aria-hidden />
          Resume queue dialing
        </Button>
      )}
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

// --- lines -------------------------------------------------------------------

function BatchBoard({
  lines,
  mode,
  batchNumber,
  now,
  onSkip,
  dimmed = false,
}: {
  lines: Line[]
  mode: DialMode
  batchNumber: number
  now: number
  onSkip: () => void
  dimmed?: boolean
}) {
  const summary = summarizeLines(lines)
  const canStop = !dimmed && summary.ringing > 0
  const placeholders = mode === 'manual' ? 1 : DEFAULT_LINES_PER_BATCH

  return (
    <section className={cn('mx-auto w-full max-w-3xl', dimmed && 'opacity-50')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {mode === 'manual' ? 'Manual call' : `Batch ${batchNumber}`}
          {lines.length > 0 && mode === 'batch' && (
            <span className="ml-2 font-normal text-muted">
              {lines.length} {lines.length === 1 ? 'line' : 'lines'}
            </span>
          )}
        </h2>
        {lines.length > 0 && <SummaryChips summary={summary} />}
      </div>

      {lines.length === 0 ? (
        <div className={cn('grid gap-3', placeholders > 1 && 'sm:grid-cols-2')}>
          {Array.from({ length: placeholders }, (_, i) => (
            <div
              key={i}
              className="h-[74px] animate-pulse rounded-lg border border-dashed border-border-subtle bg-surface"
            />
          ))}
        </div>
      ) : (
        <div className={cn('grid gap-3', lines.length > 1 && 'sm:grid-cols-2')}>
          {lines.map((line) => (
            <LineCard key={line.callId} line={line} now={now} />
          ))}
        </div>
      )}

      {canStop && (
        <div className="mt-4 flex justify-center">
          <Button onClick={onSkip}>
            <SkipForward className="size-3.5" aria-hidden />
            {mode === 'manual' ? 'Cancel call' : 'Skip this batch'}
            <Kbd>S</Kbd>
          </Button>
        </div>
      )}
    </section>
  )
}

function SummaryChips({ summary }: { summary: LineSummary }) {
  const chips: { key: string; text: string; className: string }[] = []
  if (summary.live) chips.push({ key: 'live', text: `${summary.live} connected`, className: 'bg-good-bg text-good' })
  if (summary.ringing) chips.push({ key: 'ringing', text: `${summary.ringing} ringing`, className: 'bg-warn-bg text-warn' })
  if (summary.ended) chips.push({ key: 'ended', text: `${summary.ended} ended`, className: 'bg-neutral-bg text-muted' })
  if (summary.voicemail) chips.push({ key: 'vm', text: `${summary.voicemail} voicemail`, className: 'bg-neutral-bg text-muted' })
  if (summary.dropped) chips.push({ key: 'dropped', text: `${summary.dropped} picked up · dropped`, className: 'bg-bad-bg text-bad' })
  if (summary.failed) chips.push({ key: 'failed', text: `${summary.failed} failed`, className: 'bg-bad-bg text-bad' })
  if (summary.noAnswer) chips.push({ key: 'none', text: `${summary.noAnswer} didn't pick up`, className: 'bg-neutral-bg text-muted' })

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span key={chip.key} className={cn('rounded-md px-1.5 py-0.5 text-xs font-medium', chip.className)}>
          {chip.text}
        </span>
      ))}
    </div>
  )
}

const TONE: Record<LineTone, { bar: string; text: string }> = {
  idle: { bar: 'bg-border-strong', text: 'text-muted' },
  ringing: { bar: 'bg-warn', text: 'text-warn' },
  live: { bar: 'bg-good', text: 'text-good' },
  done: { bar: 'bg-border-subtle', text: 'text-muted-2' },
  warn: { bar: 'bg-warn', text: 'text-warn' },
  bad: { bar: 'bg-bad', text: 'text-bad' },
}

function LineCard({ line, now }: { line: Line; now: number }) {
  const description = describeLine(line, now)
  const tone = TONE[description.tone]
  // A hand-dialed number's "company" is its own formatted phone number.
  const showPhone = formatPhone(line.phone) !== line.companyName

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border bg-background py-3 pr-3.5 pl-4',
        description.tone === 'live' ? 'border-good' : 'border-border-subtle',
      )}
    >
      <span
        className={cn('absolute inset-y-0 left-0 w-1', tone.bar, description.pulse && 'animate-ring')}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn('truncate text-sm font-medium', description.tone === 'done' && 'text-muted')}>
            {line.companyName}
          </p>
          {showPhone && <p className="tnum mt-0.5 text-xs text-muted">{formatPhone(line.phone)}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('text-xs font-semibold whitespace-nowrap', tone.text)}>{description.label}</p>
          {description.detail && (
            <p className="tnum mt-0.5 max-w-44 truncate text-xs text-muted-2">{description.detail}</p>
          )}
        </div>
      </div>
    </div>
  )
}

// --- live call ---------------------------------------------------------------

function otherLinesText(summary: LineSummary): string {
  if (summary.ringing > 0) {
    return `${summary.ringing} other ${summary.ringing === 1 ? 'line is' : 'lines are'} still ringing until this pickup is confirmed as a person.`
  }
  const parts: string[] = []
  if (summary.noAnswer) parts.push(`${summary.noAnswer} stopped ringing`)
  if (summary.voicemail) parts.push(`${summary.voicemail} voicemail`)
  if (summary.dropped) parts.push(`${summary.dropped} picked up and dropped`)
  if (summary.failed) parts.push(`${summary.failed} failed`)
  return parts.length > 0 ? `Other lines: ${parts.join(', ')}.` : 'Hanging up opens the exit interview.'
}

function LiveCallPanel({
  line,
  lines,
  agent,
  levelsRef,
  now,
  onMute,
  onHangUp,
  onDigit,
}: {
  line: Line
  lines: Line[]
  agent: AgentAudio
  levelsRef: RefObject<AudioLevels>
  now: number
  onMute: () => void
  onHangUp: () => void
  onDigit: (digit: string) => void
}) {
  const others = summarizeLines(lines.filter((l) => l.callId !== line.callId))
  const showPhone = formatPhone(line.phone) !== line.companyName

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-wrap items-start justify-center gap-8">
      <section className="w-full max-w-xl">
        {agent.muted && (
          <div role="alert" className="mb-3 flex items-center gap-2 rounded-lg bg-bad px-4 py-3 text-sm font-semibold text-white">
            <MicOff className="size-4 shrink-0" aria-hidden />
            You&apos;re muted. They can&apos;t hear you.
            <button
              type="button"
              onClick={onMute}
              className="ml-auto cursor-pointer rounded-md bg-white/15 px-2.5 py-1 text-xs hover:bg-white/25"
            >
              Unmute (M)
            </button>
          </div>
        )}

        {agent.line === 'reconnecting' && (
          <div role="alert" className="mb-3 flex items-center gap-2 rounded-lg bg-warn-bg px-4 py-3 text-sm font-medium text-warn">
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
            Your connection dropped and is reconnecting. The prospect is still on the line.
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-good">
          <div className="flex items-center justify-between bg-good px-5 py-2.5 text-white">
            <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest">
              <span className="size-2 animate-ring rounded-full bg-white" aria-hidden />
              LIVE
            </span>
            <span className="inline-flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold" title="This call is being recorded">
                <span className="size-1.5 rounded-full bg-white" aria-hidden />
                REC
              </span>
              <span className="tnum text-base font-semibold" aria-label="Talk time">
                {formatClock(secondsSince(line.answeredAt, now))}
              </span>
            </span>
          </div>

          <div className="bg-background px-5 py-4">
            <h1 className="text-2xl font-semibold tracking-tight">{line.companyName}</h1>
            {showPhone && <p className="tnum text-sm text-muted">{formatPhone(line.phone)}</p>}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <AudioTile
                label="You"
                hint={agent.muted ? 'Muted' : 'Your mic'}
                muted={agent.muted}
                levelsRef={levelsRef}
                channel="input"
              />
              <AudioTile label="Them" hint="Moves when they talk" levelsRef={levelsRef} channel="output" />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onMute}
                aria-pressed={agent.muted}
                className={cn(
                  'inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition-colors',
                  agent.muted ? 'border-bad bg-bad-bg text-bad' : 'border-border-strong hover:bg-surface-2',
                )}
              >
                {agent.muted ? <MicOff className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
                {agent.muted ? 'Unmute' : 'Mute'}
                <Kbd>M</Kbd>
              </button>

              <button
                type="button"
                onClick={onHangUp}
                className="inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-bad text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                <PhoneOff className="size-4" aria-hidden />
                Hang up
                <Kbd>H</Kbd>
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-2">
              <span>{lines.length > 1 ? otherLinesText(others) : 'Hanging up opens the exit interview.'}</span>
              <Link
                href={`/companies/${line.companyId}`}
                target="_blank"
                className="shrink-0 underline hover:text-foreground"
              >
                Company record
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Always open: reps hit phone trees on most connects, and a toggle was one more click while someone waits. */}
      <DialPad mode="dtmf" busy={false} onDial={() => undefined} onDigit={onDigit} />
    </div>
  )
}

function AudioTile({
  label,
  hint,
  muted = false,
  levelsRef,
  channel,
}: {
  label: string
  hint: string
  muted?: boolean
  levelsRef: RefObject<AudioLevels>
  channel: keyof AudioLevels
}) {
  return (
    <div className={cn('rounded-lg border px-3 py-2.5', muted ? 'border-bad-bg bg-bad-bg' : 'border-border-subtle bg-surface')}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{label}</span>
        {muted ? (
          <MicOff className="size-3.5 text-bad" aria-hidden />
        ) : (
          <LevelMeter
            levelsRef={levelsRef}
            channel={channel}
            bars={8}
            className={channel === 'input' ? 'text-good' : 'text-accent'}
          />
        )}
      </div>
      <p className={cn('mt-1 text-xs', muted ? 'font-semibold text-bad' : 'text-muted')}>{hint}</p>
    </div>
  )
}

// --- primitives --------------------------------------------------------------

/**
 * Reads audio levels from a ref on animation frames and writes bar opacity
 * straight to the DOM. The Voice SDK reports levels many times a second;
 * routing that through React state would re-render the whole dialer to move
 * a few pixels.
 */
function LevelMeter({
  levelsRef,
  channel,
  bars,
  className,
}: {
  levelsRef: RefObject<AudioLevels>
  channel: keyof AudioLevels
  bars: number
  className?: string
}) {
  const containerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let frame = 0
    let smoothed = 0
    const tick = () => {
      const raw = levelsRef.current?.[channel] ?? 0
      smoothed = raw > smoothed ? raw : smoothed * 0.85
      const lit = Math.min(bars, Math.ceil(smoothed * bars * 2))
      const element = containerRef.current
      if (element) {
        Array.from(element.children).forEach((child, index) => {
          ;(child as HTMLElement).style.opacity = index < lit ? '1' : '0.2'
        })
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [levelsRef, channel, bars])

  return (
    <span ref={containerRef} className={cn('inline-flex h-3 items-end gap-0.5', className)} aria-hidden>
      {Array.from({ length: bars }, (_, index) => (
        <span
          key={index}
          className="w-0.5 rounded-sm bg-current"
          style={{ height: `${35 + (index * 65) / Math.max(1, bars - 1)}%`, opacity: 0.2 }}
        />
      ))}
    </span>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded bg-black/10 px-1 font-sans text-[10px] leading-4 font-medium opacity-80">
      {children}
    </kbd>
  )
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}
