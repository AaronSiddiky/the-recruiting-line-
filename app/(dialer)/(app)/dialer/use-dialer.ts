'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Call as TwilioCall, Device as TwilioDevice } from '@twilio/voice-sdk'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_LINES_PER_BATCH } from '@/lib/constants'
import { playCue, primeAudio } from './audio-cues'
import {
  describeLine,
  dialerReducer,
  initialDialerState,
  selectLines,
  selectLiveLine,
  selectStats,
  type CallRow,
  type LineMeta,
  type SyncState,
} from './dialer-machine'

export type { DialerPhase, Line, WrapCall } from './dialer-machine'

export type AgentLineState = 'offline' | 'connecting' | 'open' | 'reconnecting'
export type AgentAudio = { line: AgentLineState; muted: boolean; warnings: string[] }
export type AudioLevels = { input: number; output: number }

type BatchResponse = {
  batchId?: string
  lines?: LineMeta[]
  skippedForHours?: number
  exhausted?: boolean
  busy?: boolean
  /** Twilio's concurrent-call cap left no room for (all of) the requested lines. */
  capped?: boolean
  cap?: number
  agents?: number
  inFlight?: number
}

/** Why a rep is waiting: the account's call slots and who holds them. */
export type LineWait = { cap: number; agents: number; inFlight: number }

/** How often a rep waiting for a free call slot asks again. */
const WAIT_RETRY_MS = 4000

const OFFLINE_AGENT: AgentAudio = { line: 'offline', muted: false, warnings: [] }

class SessionConflict extends Error {
  constructor(
    message: string,
    public lastSeenSeconds: number,
  ) {
    super(message)
  }
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string
    activeElsewhere?: boolean
    lastSeenSeconds?: number
  }
  if (response.status === 409 && data.activeElsewhere) {
    throw new SessionConflict(data.error ?? 'Already dialing elsewhere.', data.lastSeenSeconds ?? 0)
  }
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
  return data
}

/**
 * Drives the dialer: the agent's softphone on one side, the prospects' legs on
 * the other.
 *
 * The softphone reports on the agent's own audio -- connected, muted, mic
 * level, network trouble -- and that lives here. What happened to each prospect
 * is decided server-side and read back as call rows (see dialer-machine.ts),
 * streamed over Realtime and confirmed by polling: a screen that silently
 * stopped updating mid-call is worse than no screen at all.
 */
export function useDialer() {
  const [state, dispatch] = useReducer(dialerReducer, initialDialerState)
  const [agent, setAgent] = useState<AgentAudio>(OFFLINE_AGENT)
  const [sync, setSync] = useState<SyncState>('offline')
  const [lineWait, setLineWait] = useState<LineWait | null>(null)

  const levelsRef = useRef<AudioLevels>({ input: 0, output: 0 })
  const deviceRef = useRef<TwilioDevice | null>(null)
  const connectionRef = useRef<TwilioCall | null>(null)
  const endingRef = useRef(false)
  const stateRef = useRef(state)
  const prevPhaseRef = useRef(state.phase)
  const prevNoticeRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const { sessionId, phase, settledAt, mode } = state

  // --- Prospect legs: polling (always) ----------------------------------------

  const refresh = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/session/${id}/calls`, { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const data = (await response.json()) as { calls: CallRow[]; rejectedByTwilio?: number }
      dispatch({ type: 'ROWS', rows: data.calls, now: Date.now() })
      if (data.rejectedByTwilio) {
        dispatch({
          type: 'ERROR',
          message:
            'Twilio is rejecting calls: the account\u2019s concurrent-call limit is reached (error 10004). ' +
            'Raise the limit in the Twilio Console, or lower LINES_PER_BATCH.',
        })
      }
      setSync((current) => (current === 'offline' || current === 'connecting' ? 'polling' : current))
    } catch {
      setSync('offline')
    }
  }, [])

  const dialingOrLive = phase === 'dialing' || phase === 'live'

  useEffect(() => {
    if (!sessionId) return
    // Poll hard whenever lines are out and Realtime isn't confirmed. Keep a
    // slower reconciliation poll even when it is: sockets die quietly.
    const every = !dialingOrLive ? 8000 : sync === 'live' ? 3000 : 1500
    const timer = setInterval(() => void refresh(sessionId), every)
    return () => clearInterval(timer)
  }, [sessionId, dialingOrLive, sync, refresh])

  // --- Prospect legs: Realtime (fast path) ------------------------------------

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null

    void (async () => {
      // Attach the signed-in user's JWT before joining. Without it the socket
      // can join as an anonymous client, and RLS then filters out every call
      // row without raising an error: the dialer simply never hears anything.
      await supabase.auth.getSession()
      await supabase.realtime.setAuth()
      if (cancelled) return

      channel = supabase
        .channel(`dialer:${sessionId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'calls', filter: `session_id=eq.${sessionId}` },
          (payload) => {
            const row = payload.new as CallRow
            if (row?.id) dispatch({ type: 'ROWS', rows: [row], now: Date.now() })
          },
        )
        .subscribe((status) => {
          if (!cancelled) setSync(status === 'SUBSCRIBED' ? 'live' : 'polling')
        })
    })()

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [sessionId])

  // --- Call volume ------------------------------------------------------------

  const VOLUME_KEY = 'dialer.callVolume'
  const [callVolume, setCallVolumeState] = useState(1)
  const callVolumeRef = useRef(1)

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(VOLUME_KEY))
      if (saved > 0 && saved <= 1) {
        callVolumeRef.current = saved
        queueMicrotask(() => setCallVolumeState(saved))
      }
    } catch {
      // No storage; default volume.
    }
  }, [])

  /**
   * The Voice SDK has no public output-volume control; it plays the far end
   * through <audio> elements it owns. Reach those and set their volume.
   */
  const applyCallVolume = useCallback((v: number) => {
    const conn = connectionRef.current as unknown as {
      _mediaHandler?: { outputs?: Map<string, { audio?: HTMLAudioElement }>; _masterAudio?: HTMLAudioElement | null }
    } | null
    const mh = conn?._mediaHandler
    if (!mh) return
    for (const out of mh.outputs?.values() ?? []) if (out.audio) out.audio.volume = v
    if (mh._masterAudio) mh._masterAudio.volume = v
  }, [])

  const setCallVolume = useCallback(
    (v: number) => {
      const clamped = Math.min(1, Math.max(0, v))
      callVolumeRef.current = clamped
      setCallVolumeState(clamped)
      applyCallVolume(clamped)
      try {
        localStorage.setItem(VOLUME_KEY, String(clamped))
      } catch {
        // Ignore.
      }
    },
    [applyCallVolume],
  )

  // --- Lines per batch (rep's preference) ------------------------------------

  const LINES_KEY = 'dialer.lines'
  const [linesWanted, setLinesWantedState] = useState(DEFAULT_LINES_PER_BATCH)
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(LINES_KEY))
      if (saved >= 1 && saved <= 6) queueMicrotask(() => setLinesWantedState(saved))
    } catch {
      // Ignore.
    }
  }, [])
  /** Switch microphones mid-session (the SDK swaps the track live). */
  const setMicDevice = useCallback(async (deviceId: string) => {
    await deviceRef.current?.audio?.setInputDevice(deviceId).catch(() => undefined)
  }, [])

  const setLinesWanted = useCallback((n: number) => {
    const v = Math.min(6, Math.max(1, Math.round(n)))
    setLinesWantedState(v)
    try {
      localStorage.setItem(LINES_KEY, String(v))
    } catch {
      // Ignore.
    }
  }, [])
  const linesWantedRef = useRef(linesWanted)
  useEffect(() => {
    linesWantedRef.current = linesWanted
  }, [linesWanted])

  // --- The agent's own line ---------------------------------------------------

  const connectSoftphone = useCallback(async (id: string) => {
    const tokenResponse = await fetch('/api/twilio/token')
    const { token, error } = (await tokenResponse.json()) as { token?: string; error?: string }
    if (!token) throw new Error(error ?? 'Could not get a voice token.')

    // Loaded lazily: the Voice SDK touches `window` at import time.
    const { Device, Call } = await import('@twilio/voice-sdk')
    // Opus first: wideband, packet-loss tolerant. PCMU stays as the fallback.
    const device = new Device(token, {
      logLevel: 'error',
      codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
    })
    deviceRef.current = device
    // The rep's chosen microphone, if they picked one on the home screen.
    try {
      const micId = localStorage.getItem('dialer.micDeviceId')
      if (micId) await device.audio?.setInputDevice(micId).catch(() => undefined)
    } catch {
      // No storage; the browser default mic is used.
    }
    device.on('error', (e: { message: string }) => dispatch({ type: 'ERROR', message: e.message }))

    setAgent({ line: 'connecting', muted: false, warnings: [] })
    const connection = await device.connect({ params: { sessionId: id } })
    connectionRef.current = connection

    connection.on('accept', () => {
      setAgent((a) => ({ ...a, line: 'open' }))
      // Outputs exist only once media is up; apply the remembered volume then.
      setTimeout(() => applyCallVolume(callVolumeRef.current), 300)
    })
    connection.on('reconnecting', () => setAgent((a) => ({ ...a, line: 'reconnecting' })))
    connection.on('reconnected', () => setAgent((a) => ({ ...a, line: 'open' })))
    connection.on('mute', (isMuted: boolean) => setAgent((a) => ({ ...a, muted: isMuted })))
    connection.on('warning', (name: string) =>
      setAgent((a) => (a.warnings.includes(name) ? a : { ...a, warnings: [...a.warnings, name] })),
    )
    connection.on('warning-cleared', (name: string) =>
      setAgent((a) => ({ ...a, warnings: a.warnings.filter((w) => w !== name) })),
    )
    // Fires many times a second. Written to a ref and read by the meters on
    // animation frames, so it never re-renders the dialer.
    connection.on('volume', (input: number, output: number) => {
      levelsRef.current = { input, output }
    })
    connection.on('disconnect', () => {
      connectionRef.current = null
      levelsRef.current = { input: 0, output: 0 }
      setAgent(OFFLINE_AGENT)
      if (!endingRef.current) {
        dispatch({ type: 'SESSION_ENDED', error: 'Your line dropped. Start again to keep dialing.' })
        void postJson('/api/session/end', { sessionId: id }).catch(() => undefined)
      }
    })

    if (connection.status() === 'open') setAgent((a) => ({ ...a, line: 'open' }))
  }, [applyCallVolume])

  // --- Dialing ----------------------------------------------------------------

  const linesPerBatchRef = useRef(DEFAULT_LINES_PER_BATCH)
  const queueDryRef = useRef(false)
  const toppingUpRef = useRef(false)

  const startBatch = useCallback(
    async (id: string) => {
      dispatch({ type: 'DIAL_REQUESTED', mode: 'batch' })
      try {
        const result = await postJson<BatchResponse>('/api/session/batch', { sessionId: id })
        if (result.capped && !result.lines?.length) {
          // No free slot: every call the account may hold is in use, usually by
          // another rep. Park in `ready` and let the wait effect retry quietly;
          // a warning here would auto-dismiss and leave a screen that looks idle.
          setLineWait({ cap: result.cap ?? 3, agents: result.agents ?? 0, inFlight: result.inFlight ?? 0 })
          dispatch({ type: 'RETURN_TO_READY', notice: null })
          return
        }
        setLineWait(null)
        if (result.exhausted || !result.lines?.length) {
          queueDryRef.current = true
          dispatch({ type: 'QUEUE_EXHAUSTED' })
          return
        }
        dispatch({
          type: 'LINES_STARTED',
          mode: 'batch',
          lines: result.lines,
          nowMs: Date.now(),
          skippedForHours: result.skippedForHours,
        })
        void refresh(id)
      } catch (e) {
        dispatch({ type: 'DIAL_FAILED', message: e instanceof Error ? e.message : 'Could not start the batch.' })
      }
    },
    [refresh],
  )

  const openSession = useCallback(async () => {
    endingRef.current = false
    dispatch({ type: 'SESSION_CONNECTING' })
    setSync('connecting')
    let session: { sessionId: string; linesPerBatch?: number }
    try {
      session = await postJson<{ sessionId: string; linesPerBatch?: number }>('/api/session/start', { lines: linesWantedRef.current })
    } catch (e) {
      const conflict = e instanceof SessionConflict ? e : null
      if (!conflict) throw e
      const ago = conflict.lastSeenSeconds
      const takeOver = window.confirm(
        `This account is already dialing in another window (active ${ago}s ago).\n\n` +
          'If that is someone else using your login, taking over hangs up their calls. ' +
          'Each rep should sign in with their own account.\n\nTake over anyway?',
      )
      if (!takeOver) throw new Error('Already dialing in another window. End that session first, or use your own login.')
      session = await postJson<{ sessionId: string; linesPerBatch?: number }>('/api/session/start', { force: true, lines: linesWantedRef.current })
    }
    linesPerBatchRef.current = session.linesPerBatch ?? DEFAULT_LINES_PER_BATCH
    queueDryRef.current = false
    await connectSoftphone(session.sessionId)
    dispatch({ type: 'SESSION_READY', sessionId: session.sessionId })
    return session.sessionId
  }, [connectSoftphone])

  const start = useCallback(async () => {
    primeAudio()
    try {
      const id = await openSession()
      await startBatch(id)
    } catch (e) {
      dispatch({ type: 'SESSION_ENDED', error: e instanceof Error ? e.message : 'Could not start the session.' })
      setSync('offline')
    }
  }, [openSession, startBatch])

  /**
   * Dial one hand-typed number. Opens a session first if none is running, so
   * the pad works as a plain phone.
   */
  const manualDial = useCallback(
    async (phone: string) => {
      primeAudio()
      setLineWait(null)
      try {
        const id = stateRef.current.sessionId ?? (await openSession())
        dispatch({ type: 'DIAL_REQUESTED', mode: 'manual' })
        const { line } = await postJson<{ line: LineMeta }>('/api/session/dial', {
          sessionId: id,
          phone,
        })
        dispatch({ type: 'LINES_STARTED', mode: 'manual', lines: [line], nowMs: Date.now() })
        void refresh(id)
      } catch (e) {
        dispatch({ type: 'DIAL_FAILED', message: e instanceof Error ? e.message : 'Could not place the call.' })
      }
    },
    [openSession, refresh],
  )

  // Waiting for a free call slot: ask again until one opens, then start
  // dialing on our own. Silent on purpose: no dispatch while still capped, so
  // nothing flickers and no cue replays every few seconds.
  const waitingForLine = lineWait !== null
  const waitingRequestRef = useRef(false)
  useEffect(() => {
    if (!waitingForLine || phase !== 'ready' || !sessionId) return
    const timer = setInterval(async () => {
      if (waitingRequestRef.current) return
      waitingRequestRef.current = true
      try {
        const result = await postJson<BatchResponse>('/api/session/batch', { sessionId })
        const current = stateRef.current
        if (current.sessionId !== sessionId || current.phase !== 'ready') return
        if (result.capped && !result.lines?.length) {
          setLineWait({ cap: result.cap ?? 3, agents: result.agents ?? 0, inFlight: result.inFlight ?? 0 })
          return
        }
        setLineWait(null)
        if (result.exhausted || !result.lines?.length) {
          queueDryRef.current = true
          dispatch({ type: 'QUEUE_EXHAUSTED' })
          return
        }
        dispatch({ type: 'DIAL_REQUESTED', mode: 'batch' })
        dispatch({
          type: 'LINES_STARTED',
          mode: 'batch',
          lines: result.lines,
          nowMs: Date.now(),
          skippedForHours: result.skippedForHours,
        })
        void refresh(sessionId)
      } catch {
        // A refused or dropped request is simply asked again next tick.
      } finally {
        waitingRequestRef.current = false
      }
    }, WAIT_RETRY_MS)
    return () => clearInterval(timer)
  }, [waitingForLine, phase, sessionId, refresh])

  const resumeQueue = useCallback(() => {
    const id = stateRef.current.sessionId
    if (id) void startBatch(id)
  }, [startBatch])

  const end = useCallback(async () => {
    setLineWait(null)
    const id = stateRef.current.sessionId
    endingRef.current = true
    connectionRef.current?.disconnect()
    deviceRef.current?.destroy()
    connectionRef.current = null
    deviceRef.current = null
    levelsRef.current = { input: 0, output: 0 }
    setAgent(OFFLINE_AGENT)
    setSync('offline')
    dispatch({ type: 'SESSION_ENDED' })
    if (id) await postJson('/api/session/end', { sessionId: id }).catch(() => undefined)
  }, [])

  const hangUp = useCallback(async () => {
    const { liveCallId, sessionId: id } = stateRef.current
    if (!liveCallId) return
    // Recorded before the request, so the exit interview can say who ended it.
    dispatch({ type: 'AGENT_HANGUP', callId: liveCallId })
    await postJson(`/api/calls/${liveCallId}/hangup`).catch(() => undefined)
    if (id) void refresh(id)
  }, [refresh])

  const voicemailLeftRef = useRef<Set<string>>(new Set())

  /** Play the rep's pre-recorded message into the live call and hang up. */
  const leaveVoicemail = useCallback(async () => {
    const { liveCallId, sessionId: id } = stateRef.current
    if (!liveCallId) return
    try {
      await postJson(`/api/calls/${liveCallId}/voicemail`)
      voicemailLeftRef.current.add(liveCallId)
      dispatch({ type: 'AGENT_HANGUP', callId: liveCallId })
      if (id) void refresh(id)
    } catch (e) {
      dispatch({ type: 'ERROR', message: e instanceof Error ? e.message : 'Could not leave the voicemail.' })
    }
  }, [refresh])

  const wasVoicemailLeft = useCallback((callId: string) => voicemailLeftRef.current.has(callId), [])

  const skipBatch = useCallback(async () => {
    const current = stateRef.current
    const out = selectLines(current).filter(
      (line) => !line.endedAt && (line.status === 'dialing' || line.status === 'ringing'),
    )
    await Promise.all(
      out.map((line) => postJson(`/api/calls/${line.callId}/hangup`).catch(() => undefined)),
    )
    if (current.sessionId) void refresh(current.sessionId)
  }, [refresh])

  const toggleMute = useCallback(() => {
    const connection = connectionRef.current
    if (!connection) return
    connection.mute(!connection.isMuted())
    // The 'mute' event confirms it; set now so the button never lags a press.
    setAgent((a) => ({ ...a, muted: connection.isMuted() }))
  }, [])

  /** DTMF into the conference, for phone trees. */
  const sendDigits = useCallback((digits: string) => {
    connectionRef.current?.sendDigits(digits)
  }, [])

  const finishWrapup = useCallback(() => {
    const current = stateRef.current
    dispatch({ type: 'WRAPUP_DONE' })
    if (current.mode === 'batch' && current.sessionId) void startBatch(current.sessionId)
  }, [startBatch])

  const dismissNotice = useCallback(() => dispatch({ type: 'DISMISS_NOTICE' }), [])

  // --- Transitions with side effects -----------------------------------------

  // Every line finished: a manual call hands back the pad, a batch fans out
  // Continuous dialing: as soon as a line finishes without a conversation,
  // replace it, so the rep never waits for a whole batch to die. Stops once
  // the queue is dry; the batch then settles the normal way.
  useEffect(() => {
    if (phase !== 'dialing' || mode !== 'batch' || !sessionId || state.liveCallId) return
    if (queueDryRef.current || toppingUpRef.current) return
    const lines = selectLines(state)
    if (lines.length === 0) return
    const inFlight = lines.filter((line) => !line.endedAt && (line.status === 'dialing' || line.status === 'ringing')).length
    const needed = linesPerBatchRef.current - inFlight
    if (needed <= 0) return

    toppingUpRef.current = true
    void (async () => {
      try {
        const result = await postJson<BatchResponse>('/api/session/batch', { sessionId, limit: needed })
        const current = stateRef.current
        if (current.sessionId !== sessionId || current.phase !== 'dialing') return
        if (result.capped && !result.lines?.length) return // retried on the next change
        if (result.exhausted || !result.lines?.length) {
          queueDryRef.current = true
          return
        }
        dispatch({
          type: 'LINES_STARTED',
          mode: 'batch',
          append: true,
          lines: result.lines,
          skippedForHours: result.skippedForHours,
          nowMs: Date.now(),
        })
        void refresh(sessionId)
      } catch {
        // A refused top-up (call in progress, network) is retried on the next change.
      } finally {
        toppingUpRef.current = false
      }
    })()
  }, [state, phase, mode, sessionId, refresh])

  // again. A beat first, so the final state of each line is readable.
  useEffect(() => {
    if (settledAt == null || !sessionId) return
    // A top-up is already replacing the finished lines; let it land.
    if (toppingUpRef.current) return
    const timer = setTimeout(() => {
      if (mode === 'manual') {
        const line = selectLines(stateRef.current)[0]
        dispatch({
          type: 'RETURN_TO_READY',
          notice: line ? `${line.companyName}: ${describeLine(line, Date.now()).label}` : null,
        })
      } else {
        void startBatch(sessionId)
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [settledAt, mode, sessionId, startBatch])

  useEffect(() => {
    const previous = prevPhaseRef.current
    prevPhaseRef.current = phase
    if (phase === 'live' && previous !== 'live') playCue('connect')
    if (phase === 'wrapup' && previous !== 'wrapup' && state.wrap?.endedBy === 'prospect') {
      playCue('hangup')
    }
  }, [phase, state.wrap])

  const noticeId = state.notice?.id
  const noticeTone = state.notice?.tone
  useEffect(() => {
    if (noticeId == null) return
    if (noticeId !== prevNoticeRef.current) {
      prevNoticeRef.current = noticeId
      if (noticeTone === 'warn') playCue('voicemail')
    }
    if (noticeTone === 'bad') return
    const timer = setTimeout(() => dispatch({ type: 'DISMISS_NOTICE', id: noticeId }), 7000)
    return () => clearTimeout(timer)
  }, [noticeId, noticeTone])

  // The tab title is the only thing visible while the agent is in another
  // window, which is exactly when a hang-up gets missed.
  useEffect(() => {
    const base = 'RecruitingLine'
    const live = selectLiveLine(state)
    let title = base
    if (state.phase === 'live' && live) title = `● Live · ${live.companyName}`
    else if (state.phase === 'wrapup') title = state.wrap?.endedBy === 'prospect' ? 'Prospect hung up' : 'Call ended'
    else if (state.phase === 'dialing') title = 'Dialing…'
    document.title = title === base ? base : `${title} · ${base}`
  }, [state])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const current = stateRef.current
      if (current.phase === 'wrapup') return
      const key = event.key.toLowerCase()
      if (key === 'm' && connectionRef.current) {
        event.preventDefault()
        toggleMute()
      } else if (key === 'h' && current.phase === 'live') {
        event.preventDefault()
        void hangUp()
      } else if (key === 'v' && current.phase === 'live') {
        event.preventDefault()
        void leaveVoicemail()
      } else if (key === 's' && current.phase === 'dialing') {
        event.preventDefault()
        void skipBatch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleMute, hangUp, skipBatch, leaveVoicemail])

  // Closing the tab mid-call would drop a live prospect with no warning.
  useEffect(() => {
    if (phase !== 'live' && phase !== 'dialing') return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [phase])

  useEffect(() => {
    return () => {
      endingRef.current = true
      connectionRef.current?.disconnect()
      deviceRef.current?.destroy()
      document.title = 'RecruitingLine'
    }
  }, [])

  const lines = useMemo(() => selectLines(state), [state])
  const liveLine = useMemo(() => selectLiveLine(state), [state])
  const stats = useMemo(() => selectStats(state), [state])

  return {
    phase,
    mode,
    batchNumber: state.batchNumber,
    lines,
    liveLine,
    wrap: state.wrap,
    notice: state.notice,
    lineWait,
    error: state.error,
    stats,
    agent,
    sync,
    levelsRef,
    start,
    manualDial,
    resumeQueue,
    end,
    hangUp,
    leaveVoicemail,
    wasVoicemailLeft,
    skipBatch,
    toggleMute,
    sendDigits,
    finishWrapup,
    dismissNotice,
    callVolume,
    setCallVolume,
    linesWanted,
    setLinesWanted,
    setMicDevice,
  }
}
