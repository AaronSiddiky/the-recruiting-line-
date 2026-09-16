import type { Call, CallStatus } from '@/types/db'

/**
 * The dialer's call-state machine. No React and no I/O, so every transition
 * can be exercised directly.
 *
 * Call rows reach the browser two ways: Supabase Realtime, which is fast but
 * can stop without saying so, and a poll of the session's calls, which is slow
 * but always answers. Both feed `ROWS`. Merges are ordered by `updated_at` and
 * every transition is derived from the merged rows, so it does not matter which
 * feed lands first, whether a row is delivered twice, or whether one feed dies.
 */

export type CallRow = Pick<
  Call,
  | 'id'
  | 'company_id'
  | 'status'
  | 'amd_result'
  | 'outcome'
  | 'started_at'
  | 'answered_at'
  | 'ended_at'
  | 'duration_seconds'
  | 'notes'
  | 'updated_at'
>

export type LineMeta = {
  callId: string
  companyId: string
  companyName: string
  phone: string
}

export type Line = LineMeta & {
  status: CallStatus
  startedAt: string | null
  answeredAt: string | null
  endedAt: string | null
  durationSeconds: number | null
  amdResult: string | null
  notes: string | null
}

export type DialerPhase =
  | 'idle' // no session
  | 'connecting' // opening the agent's softphone line
  | 'ready' // line open, nothing dialing
  | 'dialing' // lines are out
  | 'live' // bridged to a prospect
  | 'wrapup' // call over, exit interview open
  | 'exhausted' // queue is dry

export type DialMode = 'batch' | 'manual'
export type EndedBy = 'you' | 'prospect'
export type SyncState = 'connecting' | 'live' | 'polling' | 'offline'

export type WrapCall = Line & { endedBy: EndedBy; talkSeconds: number | null }
export type Notice = { id: number; tone: 'info' | 'warn' | 'bad'; text: string }

export type DialerState = {
  phase: DialerPhase
  mode: DialMode
  sessionId: string | null
  batchNumber: number
  activeIds: string[]
  meta: Record<string, LineMeta>
  rows: Record<string, CallRow>
  liveCallId: string | null
  wrap: WrapCall | null
  notice: Notice | null
  /** Set once, the moment every active line has finished with nobody live. */
  settledAt: number | null
  hungUpByAgent: Record<string, true>
  wrapped: Record<string, true>
  error: string | null
}

export type DialerAction =
  | { type: 'SESSION_CONNECTING' }
  | { type: 'SESSION_READY'; sessionId: string }
  | { type: 'SESSION_ENDED'; error?: string | null }
  | { type: 'DIAL_REQUESTED'; mode: DialMode }
  | {
      type: 'LINES_STARTED'
      /** Top-up: keep the lines still ringing and add these beside them. */
      append?: boolean
      mode: DialMode
      lines: LineMeta[]
      nowMs: number
      skippedForHours?: number
    }
  | { type: 'QUEUE_EXHAUSTED' }
  | { type: 'DIAL_FAILED'; message: string }
  | { type: 'ROWS'; rows: CallRow[]; now: number }
  | { type: 'AGENT_HANGUP'; callId: string }
  | { type: 'WRAPUP_DONE' }
  | { type: 'RETURN_TO_READY'; notice: string | null }
  | { type: 'ERROR'; message: string | null }
  | { type: 'DISMISS_NOTICE'; id?: number }

export const initialDialerState: DialerState = {
  phase: 'idle',
  mode: 'batch',
  sessionId: null,
  batchNumber: 0,
  activeIds: [],
  meta: {},
  rows: {},
  liveCallId: null,
  wrap: null,
  notice: null,
  settledAt: null,
  hungUpByAgent: {},
  wrapped: {},
  error: null,
}

const FINISHED: ReadonlySet<CallStatus> = new Set<CallStatus>([
  'no_answer',
  'busy',
  'failed',
  'voicemail',
  'canceled',
])

// --- time --------------------------------------------------------------------

/**
 * PostgREST sends `2026-09-11T20:58:26.123456+00:00`; Realtime sends
 * `2026-09-11 20:58:26.123456+00`. Normalize both before comparing, or ordering
 * rows across the two feeds is a coin flip.
 */
export function parseTs(value: string | null | undefined): number {
  if (!value) return Number.NaN
  let s = value.trim().replace(' ', 'T')
  s = s.replace(/(\.\d{3})\d+/, '$1')
  if (/[+-]\d{2}$/.test(s)) s += ':00'
  return Date.parse(s)
}

export function secondsBetween(from: string | null, to: string | null): number | null {
  const a = parseTs(from)
  const b = parseTs(to)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.max(0, Math.round((b - a) / 1000))
}

export function secondsSince(from: string | null, nowMs: number): number | null {
  const a = parseTs(from)
  if (Number.isNaN(a) || !nowMs) return null
  return Math.max(0, Math.floor((nowMs - a) / 1000))
}

export function formatClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '0:00'
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// --- selectors ---------------------------------------------------------------

function lineFor(state: DialerState, id: string): Line {
  const meta = state.meta[id]
  const row = state.rows[id]
  return {
    callId: id,
    companyId: meta?.companyId ?? row?.company_id ?? '',
    companyName: meta?.companyName ?? 'Unknown company',
    phone: meta?.phone ?? '',
    status: row?.status ?? 'dialing',
    startedAt: row?.started_at ?? null,
    answeredAt: row?.answered_at ?? null,
    endedAt: row?.ended_at ?? null,
    durationSeconds: row?.duration_seconds ?? null,
    amdResult: row?.amd_result ?? null,
    notes: row?.notes ?? null,
  }
}

export function selectLines(state: DialerState): Line[] {
  return state.activeIds.map((id) => lineFor(state, id))
}

export function selectLiveLine(state: DialerState): Line | null {
  return state.liveCallId ? lineFor(state, state.liveCallId) : null
}

/** Session totals, counted from the rows so a redelivered row can't inflate them. */
export function selectStats(state: DialerState) {
  let dialed = 0
  let connected = 0
  let voicemail = 0
  let dropped = 0
  for (const row of Object.values(state.rows)) {
    dialed += 1
    if (row.status === 'connected' && row.answered_at) connected += 1
    if (row.status === 'voicemail') voicemail += 1
    if (row.status === 'canceled' && row.answered_at) dropped += 1
  }
  return { dialed, connected, voicemail, dropped }
}

export type LineSummary = {
  live: number
  ringing: number
  ended: number
  voicemail: number
  dropped: number
  failed: number
  noAnswer: number
}

export function summarizeLines(lines: Line[]): LineSummary {
  const s: LineSummary = { live: 0, ringing: 0, ended: 0, voicemail: 0, dropped: 0, failed: 0, noAnswer: 0 }
  for (const line of lines) {
    if (line.status === 'connected') {
      if (line.endedAt) s.ended += 1
      else s.live += 1
    } else if (line.status === 'voicemail') {
      s.voicemail += 1
    } else if (line.status === 'canceled' && line.answeredAt) {
      s.dropped += 1
    } else if (line.status === 'failed') {
      // Kept apart from unanswered lines: a failure is a bad number or a Twilio
      // problem, not a prospect who didn't pick up.
      s.failed += 1
    } else if ((line.status === 'dialing' || line.status === 'ringing') && !line.endedAt) {
      s.ringing += 1
    } else {
      s.noAnswer += 1
    }
  }
  return s
}

export type LineTone = 'idle' | 'ringing' | 'live' | 'done' | 'warn' | 'bad'
export type LineDescription = {
  label: string
  tone: LineTone
  detail: string | null
  pulse: boolean
}

function shortReason(notes: string | null): string | null {
  if (!notes) return null
  const text = notes.replace(/^(Manual dial failed|Dial failed):\s*/i, '')
  return text.length > 42 ? `${text.slice(0, 41)}…` : text
}

/**
 * What a line card says. The distinction that matters most on a parallel
 * dialer is a line that stopped ringing (the prospect never heard a thing)
 * versus one that picked up and was dropped (they heard a hang-up). The second
 * is a real person who may remember the number.
 */
export function describeLine(line: Line, nowMs: number): LineDescription {
  const out = !line.endedAt
  switch (line.status) {
    case 'dialing':
      return out
        ? { label: 'Dialing', tone: 'idle', detail: formatClock(secondsSince(line.startedAt, nowMs)), pulse: true }
        : { label: 'Stopped', tone: 'done', detail: 'Never picked up', pulse: false }
    case 'ringing':
      return out
        ? { label: 'Ringing', tone: 'ringing', detail: formatClock(secondsSince(line.startedAt, nowMs)), pulse: true }
        : { label: 'Stopped ringing', tone: 'done', detail: 'Never picked up', pulse: false }
    case 'connected':
      return out
        ? { label: 'Connected to you', tone: 'live', detail: formatClock(secondsSince(line.answeredAt, nowMs)), pulse: true }
        : {
            label: 'Call ended',
            tone: 'done',
            detail: formatClock(secondsBetween(line.answeredAt, line.endedAt) ?? line.durationSeconds),
            pulse: false,
          }
    case 'voicemail':
      return { label: 'Voicemail · dropped', tone: 'warn', detail: null, pulse: false }
    case 'canceled':
      return line.answeredAt
        ? { label: 'Picked up · dropped', tone: 'bad', detail: 'Heard a hang-up', pulse: false }
        : { label: 'Stopped ringing', tone: 'done', detail: 'Never picked up', pulse: false }
    case 'no_answer':
      return { label: 'No answer', tone: 'done', detail: null, pulse: false }
    case 'busy':
      return { label: 'Busy', tone: 'done', detail: null, pulse: false }
    case 'failed':
      return { label: 'Failed', tone: 'bad', detail: shortReason(line.notes), pulse: false }
  }
}

// --- reducer -----------------------------------------------------------------

function isNewer(incoming: CallRow, existing: CallRow | undefined): boolean {
  if (!existing) return true
  const a = parseTs(incoming.updated_at)
  const b = parseTs(existing.updated_at)
  if (Number.isNaN(b)) return true
  if (Number.isNaN(a)) return false
  return a >= b
}

function isDone(row: CallRow | undefined): boolean {
  return row != null && (row.ended_at != null || FINISHED.has(row.status))
}

function makeNotice(state: DialerState, tone: Notice['tone'], text: string): Notice {
  return { id: (state.notice?.id ?? 0) + 1, tone, text }
}

function wrapFor(state: DialerState, id: string, row: CallRow): WrapCall {
  return {
    ...lineFor(state, id),
    endedBy: state.hungUpByAgent[id] ? 'you' : 'prospect',
    talkSeconds: secondsBetween(row.answered_at, row.ended_at) ?? row.duration_seconds,
  }
}

/** Apply every transition the current rows imply. */
function derive(state: DialerState, now: number): DialerState {
  let next = state

  // 1. The live call ended.
  if (next.liveCallId) {
    const liveId = next.liveCallId
    const row = next.rows[liveId]
    if (row?.ended_at) {
      if (row.status !== 'voicemail') {
        return { ...next, liveCallId: null, phase: 'wrapup', wrap: wrapFor(next, liveId, row) }
      }
      const name = lineFor(next, liveId).companyName
      const othersRinging = next.activeIds.some((id) => id !== liveId && !isDone(next.rows[id]))
      next = {
        ...next,
        liveCallId: null,
        phase: 'dialing',
        notice: makeNotice(
          next,
          'warn',
          othersRinging
            ? `${name} was a voicemail, so it was dropped. The other lines are still ringing.`
            : `${name} was a voicemail, so it was dropped.`,
        ),
      }
    }
  }

  // 2. Someone picked up.
  if (!next.liveCallId && (next.phase === 'dialing' || next.phase === 'ready')) {
    for (const id of next.activeIds) {
      const row = next.rows[id]
      if (!row || next.wrapped[id] || row.status !== 'connected') continue
      if (!row.ended_at) {
        return { ...next, liveCallId: id, phase: 'live', settledAt: null }
      }
      if (row.answered_at) {
        // Connected and already over before either feed showed it live: a
        // pickup that hung up inside one poll interval. Still a conversation.
        return { ...next, phase: 'wrapup', wrap: wrapFor(next, id, row) }
      }
    }
  }

  // 3. Every line finished and nobody is on the phone.
  if (
    next.phase === 'dialing' &&
    !next.liveCallId &&
    next.settledAt == null &&
    next.activeIds.length > 0 &&
    next.activeIds.every((id) => isDone(next.rows[id]))
  ) {
    next = { ...next, settledAt: now }
  }

  return next
}

export function dialerReducer(state: DialerState, action: DialerAction): DialerState {
  switch (action.type) {
    case 'SESSION_CONNECTING':
      return { ...initialDialerState, phase: 'connecting' }

    case 'SESSION_READY':
      return { ...state, sessionId: action.sessionId, phase: 'ready', error: null }

    case 'SESSION_ENDED':
      return { ...initialDialerState, error: action.error ?? null }

    case 'DIAL_REQUESTED':
      // Clear the previous lines. Left in place, their finished rows would
      // immediately "settle" the batch that is about to start.
      return {
        ...state,
        phase: 'dialing',
        mode: action.mode,
        activeIds: [],
        liveCallId: null,
        settledAt: null,
        error: null,
      }

    case 'LINES_STARTED': {
      // A response that lands after the session ended, or after a newer
      // request, describes lines nobody is waiting on.
      if (!state.sessionId || state.phase !== 'dialing') return state
      const meta = { ...state.meta }
      const rows = { ...state.rows }
      const startedAt = new Date(action.nowMs).toISOString()
      for (const line of action.lines) {
        meta[line.callId] = line
        rows[line.callId] ??= {
          id: line.callId,
          company_id: line.companyId,
          status: 'dialing',
          amd_result: null,
          outcome: null,
          started_at: startedAt,
          answered_at: null,
          ended_at: null,
          duration_seconds: null,
          notes: null,
          // Empty, so the first real row from either feed replaces it.
          updated_at: '',
        }
      }
      const skipped = action.skippedForHours ?? 0
      return derive(
        {
          ...state,
          mode: action.mode,
          meta,
          rows,
          activeIds: action.append
            ? [...state.activeIds.filter((id) => !isDone(rows[id])), ...action.lines.map((line) => line.callId)]
            : action.lines.map((line) => line.callId),
          batchNumber: action.mode === 'batch' && !action.append ? state.batchNumber + 1 : state.batchNumber,
          // New lines are out again, so the batch is no longer settled.
          settledAt: action.append ? null : state.settledAt,
          notice:
            skipped > 0
              ? makeNotice(
                  state,
                  'info',
                  `${skipped} ${skipped === 1 ? 'lead was' : 'leads were'} skipped for being outside their local calling hours.`,
                )
              : state.notice,
        },
        action.nowMs,
      )
    }

    case 'QUEUE_EXHAUSTED':
      return { ...state, phase: 'exhausted', activeIds: [], settledAt: null }

    case 'DIAL_FAILED':
      return {
        ...state,
        phase: state.sessionId ? 'ready' : 'idle',
        activeIds: [],
        settledAt: null,
        error: action.message,
      }

    case 'ROWS': {
      if (!state.sessionId) return state
      let rows = state.rows
      for (const incoming of action.rows) {
        if (!incoming?.id || !isNewer(incoming, rows[incoming.id])) continue
        if (rows === state.rows) rows = { ...state.rows }
        rows[incoming.id] = incoming
      }
      return rows === state.rows ? state : derive({ ...state, rows }, action.now)
    }

    case 'AGENT_HANGUP':
      return { ...state, hungUpByAgent: { ...state.hungUpByAgent, [action.callId]: true } }

    case 'WRAPUP_DONE':
      if (!state.wrap) return state
      return {
        ...state,
        wrapped: { ...state.wrapped, [state.wrap.callId]: true },
        wrap: null,
        phase: 'ready',
        activeIds: [],
        liveCallId: null,
        settledAt: null,
      }

    case 'RETURN_TO_READY':
      return {
        ...state,
        phase: 'ready',
        activeIds: [],
        liveCallId: null,
        settledAt: null,
        notice: action.notice ? makeNotice(state, 'info', action.notice) : state.notice,
      }

    case 'ERROR':
      return { ...state, error: action.message }

    case 'DISMISS_NOTICE':
      if (!state.notice || (action.id != null && action.id !== state.notice.id)) return state
      return { ...state, notice: null }
  }
}
