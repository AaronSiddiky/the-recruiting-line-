'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Call as TwilioCall, Device as TwilioDevice } from '@twilio/voice-sdk'
import { createClient } from '@/lib/supabase/client'
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
}

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
      const data = (await response.json()) as { calls: CallRow[] }
      dispatch({ type: 'ROWS', rows: data.calls, now: Date.now() })
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

  // --- The agent's own line ---------------------------------------------------

  const connectSoftphone = useCallback(async (id: string) => {
    const tokenResponse = await fetch('/api/twilio/token')
    const { token, error } = (await tokenResponse.json()) as { token?: string; error?: string }
    if (!token) throw new Error(error ?? 'Could not get a voice token.')

    // Loaded lazily: the Voice SDK touches `window` at import time.
    const { Device } = await import('@twilio/voice-sdk')
    const device = new Device(token, { logLevel: 'error' })
    deviceRef.current = device
    device.on('error', (e: { message: string }) => dispatch({ type: 'ERROR', message: e.message }))

    setAgent({ line: 'connecting', muted: false, warnings: [] })
    const connection = await device.connect({ params: { sessionId: id } })
    connectionRef.current = connection

    connection.on('accept', () => setAgent((a) => ({ ...a, line: 'open' })))
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
  }, [])

  // --- Dialing ----------------------------------------------------------------

  const startBatch = useCallback(
    async (id: string) => {
      dispatch({ type: 'DIAL_REQUESTED', mode: 'batch' })
      try {
        const result = await postJson<BatchResponse>('/api/session/batch', { sessionId: id })
        if (result.exhausted || !result.lines?.length) {
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
    let session: { sessionId: string }
    try {
      session = await postJson<{ sessionId: string }>('/api/session/start', {})
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
      session = await postJson<{ sessionId: string }>('/api/session/start', { force: true })
    }
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

  const resumeQueue = useCallback(() => {
    const id = stateRef.current.sessionId
    if (id) void startBatch(id)
  }, [startBatch])

  const end = useCallback(async () => {
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
  // again. A beat first, so the final state of each line is readable.
  useEffect(() => {
    if (settledAt == null || !sessionId) return
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
  }
}
