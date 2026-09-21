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
import { TechExitInterview } from './tech-exit-interview'
import { DialPad } from './dial-pad'
import { VoicemailSettings } from './voicemail-settings'
import { MicSettings } from './mic-settings'
import { SpotifyDeck } from './spotify-deck'
import { requestSpotifyRefresh, useSpotifyMini } from './spotify-bus'
import { CopyScreenLink } from '../techs/[id]/copy-screen-link'
import { Pause, Volume2 } from 'lucide-react'
import { useDialer, type AgentAudio, type AudioLevels, type LineWait } from './use-dialer'
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

export function Dialer({ queueSize, techQueueSize = 0, hasVoicemail }: { queueSize: number; techQueueSize?: number; hasVoicemail: boolean }) {
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
          lines={d.lines}
          liveLine={d.liveLine}
          wrap={d.wrap}
          waitingForLine={d.lineWait !== null}
        />

        {d.agent.line !== 'offline' && (
          <AgentLineChip agent={d.agent} levelsRef={d.levelsRef} onToggleMute={d.toggleMute} />
        )}

        {d.agent.line !== 'offline' && (
          <label className="flex items-center gap-1.5 text-xs text-muted" title="Call volume (how loud the prospect is in your ear)">
            <Volume2 className="size-3.5" aria-hidden />
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(d.callVolume * 100)}
              onChange={(e) => d.setCallVolume(Number(e.target.value) / 100)}
              aria-label="Call volume"
              className="h-1 w-24 accent-accent"
            />
            <span className="tnum w-8">{Math.round(d.callVolume * 100)}%</span>
          </label>
        )}

        <MusicButton />

        <div role="tablist" aria-label="Who to dial" className="flex rounded-md border border-border-strong p-0.5 text-xs">
          {(
            [
              ['companies', `Companies · ${queueSize}`],
              ['techs', `Techs · ${techQueueSize}`],
            ] as const
          ).map(([q, label]) => (
            <button
              key={q}
              role="tab"
              type="button"
              aria-selected={d.queue === q}
              onClick={() => d.setQueue(q)}
              className={cn(
                'cursor-pointer rounded px-2 py-1',
                d.queue === q ? 'bg-surface-2 font-medium text-foreground' : 'text-muted hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

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
            <>
              <Button
                variant="primary"
                onClick={() => void d.start()}
                disabled={(d.queue === 'techs' ? techQueueSize : queueSize) === 0}
                title={(d.queue === 'techs' ? techQueueSize : queueSize) === 0 ? 'Nothing queued in this list. Use the dial pad below.' : undefined}
              >
                <Play className="size-3.5" aria-hidden />
                Start dialing
              </Button>
            </>
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
            <IdleState queueSize={d.queue === 'techs' ? techQueueSize : queueSize} />
            {pad}
            <MicSettings onChange={(id) => void d.setMicDevice(id)} />
            <VoicemailSettings hasVoicemail={hasVoicemail} />
          </div>
        )}

        {d.phase === 'connecting' && <ConnectingState />}

        {d.phase === 'ready' && (
          <div className="flex flex-col items-center gap-8">
            <ReadyState queueSize={d.queue === 'techs' ? techQueueSize : queueSize} onResume={d.resumeQueue} lineWait={d.lineWait} />
            {pad}
            <MicSettings onChange={(id) => void d.setMicDevice(id)} />
            <VoicemailSettings hasVoicemail={hasVoicemail} />
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
          <CallBoard
            lines={d.lines}
            mode={d.mode}
            callNumber={d.callNumber}
            now={now}
            onSkip={() => void d.skipBatch()}
          />
        )}

        {d.phase === 'live' && d.liveLine && (
          <LiveCallPanel
            line={d.liveLine}
            agent={d.agent}
            levelsRef={d.levelsRef}
            now={now}
            onMute={d.toggleMute}
            onHangUp={() => void d.hangUp()}
            onVoicemail={() => void d.leaveVoicemail()}
            hasVoicemail={hasVoicemail}
            onDigit={d.sendDigits}
          />
        )}

        {d.phase === 'wrapup' && (
          <CallBoard
            lines={d.lines}
            mode={d.mode}
            callNumber={d.callNumber}
            now={now}
            onSkip={() => undefined}
            dimmed
          />
        )}

        <SpotifyDeck />
      </div>

      {d.phase === 'wrapup' && d.wrap && (
        d.wrap.kind === 'tech' ? (
          <TechExitInterview
            call={d.wrap}
            endedBy={d.wrap.endedBy}
            talkSeconds={d.wrap.talkSeconds}
            saveLabel={d.mode === 'manual' ? 'Save' : 'Save and dial next'}
            onSwitchKind={() => void d.setWrapKind('company')}
            onDone={d.finishWrapup}
          />
        ) : (
          <ExitInterview
            call={d.wrap}
            endedBy={d.wrap.endedBy}
            talkSeconds={d.wrap.talkSeconds}
            saveLabel={d.mode === 'manual' ? 'Save' : 'Save and dial next'}
            defaultOutcome={d.wasVoicemailLeft(d.wrap.callId) ? 'no_answer' : null}
            onSwitchKind={() => void d.setWrapKind('tech')}
            onDone={d.finishWrapup}
          />
        )
      )}
    </div>
  )
}

// --- header ------------------------------------------------------------------

function PhaseLabel({
  phase,
  lines,
  liveLine,
  wrap,
  waitingForLine = false,
}: {
  phase: DialerPhase
  lines: Line[]
  liveLine: Line | null
  wrap: WrapCall | null
  waitingForLine?: boolean
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
      if (waitingForLine) {
        label = 'Waiting for a free line'
        dot = 'bg-warn'
        pulse = true
      } else {
        label = 'Line open · ready to dial'
        dot = 'bg-good'
      }
      break
    case 'dialing':
      dot = 'bg-warn'
      pulse = true
      label = lines[0] ? `Calling ${lines[0].companyName}` : 'Placing call…'
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
      <h1 className="text-lg font-semibold tracking-tight">Dialer</h1>
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
            {queueSize.toLocaleString()} {queueSize === 1 ? 'lead is' : 'leads are'} ready. Starting
            calls one company at a time from your own number, and moves to the next the moment a
            call ends. A pickup connects to you with a tone.
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

function ReadyState({
  queueSize,
  onResume,
  lineWait,
}: {
  queueSize: number
  onResume: () => void
  lineWait: LineWait | null
}) {
  if (lineWait) {
    // Each rep has a reserved share of the account's calls, so this is no
    // longer the other rep holding the only line. It means the account itself
    // is full -- usually a leg from an earlier call that has not closed yet.
    const needed = lineWait.agents * 2
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Loader2 className="size-4 animate-spin text-warn" aria-hidden />
          Waiting for a free line
        </h1>
        <p className="mt-2 text-sm text-muted">
          Twilio lets this account run {lineWait.cap} calls at once, and{' '}
          {lineWait.agents} rep {lineWait.agents === 1 ? 'line' : 'lines'}
          {lineWait.inFlight > 0 &&
            ` and ${lineWait.inFlight} ${lineWait.inFlight === 1 ? 'call' : 'calls'}`}{' '}
          {lineWait.inFlight > 0 || lineWait.agents !== 1 ? 'are' : 'is'} using them.
        </p>
        <p className="mt-2 text-sm font-medium">Dialing starts on its own as soon as one frees up.</p>
        {needed > lineWait.cap && (
          <p className="mt-3 text-xs text-muted-2">
            {lineWait.agents} reps dialing at once needs {needed} calls: one line and one prospect
            each. Raise the cap in the Twilio Console, or dial with fewer people at a time.
          </p>
        )}
      </div>
    )
  }
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

function CallBoard({
  lines,
  mode,
  callNumber,
  now,
  onSkip,
  dimmed = false,
}: {
  lines: Line[]
  mode: DialMode
  callNumber: number
  now: number
  onSkip: () => void
  dimmed?: boolean
}) {
  const summary = summarizeLines(lines)
  const canStop = !dimmed && summary.ringing > 0

  return (
    <section className={cn('mx-auto w-full max-w-xl', dimmed && 'opacity-50')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {mode === 'manual' ? 'Manual call' : `Call ${callNumber}`}
        </h2>
        {lines.length > 0 && <SummaryChips summary={summary} />}
      </div>

      {lines.length === 0 ? (
        <div className="h-[74px] animate-pulse rounded-lg border border-dashed border-border-subtle bg-surface" />
      ) : (
        <div className="grid gap-3">
          {lines.map((line) => (
            <LineCard key={line.callId} line={line} now={now} />
          ))}
        </div>
      )}

      {canStop && (
        <div className="mt-4 flex justify-center">
          <Button onClick={onSkip}>
            <SkipForward className="size-3.5" aria-hidden />
            {mode === 'manual' ? 'Cancel call' : 'Skip this one'}
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

function LiveCallPanel({
  line,
  agent,
  levelsRef,
  now,
  onMute,
  onHangUp,
  onVoicemail,
  hasVoicemail,
  onDigit,
}: {
  line: Line
  agent: AgentAudio
  levelsRef: RefObject<AudioLevels>
  now: number
  onMute: () => void
  onHangUp: () => void
  onVoicemail: () => void
  hasVoicemail: boolean
  onDigit: (digit: string) => void
}) {
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
                onClick={onVoicemail}
                disabled={!hasVoicemail}
                title={hasVoicemail ? 'Play your recorded message and hang up' : 'Record a voicemail message first, on the dialer home screen'}
                className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border-strong px-4 text-sm font-semibold transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Voicemail className="size-4" aria-hidden />
                Leave voicemail
                <Kbd>V</Kbd>
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

            {line.kind === 'tech' && <LiveScreenLink callId={line.callId} name={line.companyName} />}

            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-2">
              <span>Hanging up opens the exit interview.</span>
              <Link
                href={line.kind === 'tech' ? `/techs?q=${encodeURIComponent(line.phone)}` : `/companies/${line.companyId}`}
                target="_blank"
                className="shrink-0 underline hover:text-foreground"
              >
                {line.kind === 'tech' ? 'Tech record' : 'Company record'}
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

/** Play/pause for the rep's Spotify, up top so it needs no scrolling. */
function MusicButton() {
  const music = useSpotifyMini()
  const [busy, setBusy] = useState(false)
  if (!music?.connected) return null
  async function toggle() {
    setBusy(true)
    try {
      await fetch('/api/spotify/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: music!.isPlaying ? 'pause' : 'play' }),
      })
      setTimeout(requestSpotifyRefresh, 400)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      title={music.track ? `${music.track.name} · ${music.track.artist}` : 'Spotify'}
      aria-label={music.isPlaying ? 'Pause music' : 'Play music'}
      className="inline-flex h-8 max-w-56 cursor-pointer items-center gap-2 rounded-md border border-border-strong px-2 text-xs hover:bg-surface-2 disabled:opacity-50"
    >
      {music.isPlaying ? <Pause className="size-3.5 shrink-0" aria-hidden /> : <Play className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{music.track ? music.track.name : 'Spotify'}</span>
    </button>
  )
}

/**
 * The tech's own screening link, while the call is still live. Asked for by
 * name: "can you send me those questions?" happens mid-sentence, and copying
 * it after hanging up means asking them to wait.
 */
function LiveScreenLink({ callId, name }: { callId: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    fetch(`/api/calls/${callId}/context`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { screenUrl?: string | null } | null) => {
        if (!stale && d?.screenUrl) setUrl(d.screenUrl)
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [callId])

  if (!url) return null
  return (
    <div className="mt-3 rounded-lg border border-border-subtle bg-surface px-3 py-2">
      <p className="mb-1.5 text-xs font-medium text-muted">Still looking? Send them the questions while you have them.</p>
      <CopyScreenLink url={url} firstName={name.split(' ')[0]} />
    </div>
  )
}
