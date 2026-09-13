'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Call as TwilioCall, Device as TwilioDevice } from '@twilio/voice-sdk'
import { createClient } from '@/lib/supabase/client'
import type { Call, CallStatus } from '@/types/db'

export type Line = {
  callId: string
  companyId: string
  companyName: string
  phone: string
  status: CallStatus
}

export type DialerPhase =
  | 'idle'        // nothing running
  | 'connecting'  // acquiring mic + joining the conference
  | 'ready'       // parked in the conference, no batch out
  | 'dialing'     // a batch is ringing
  | 'live'        // bridged to a prospect
  | 'wrapup'      // call over, exit interview open
  | 'exhausted'   // queue is dry

type BatchResponse = {
  batchId?: string
  lines?: Omit<Line, 'status'>[]
  skippedForHours?: number
  exhausted?: boolean
  error?: string
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
  return data
}

/**
 * The dialer state machine.
 *
 * Two independent event sources drive it and they do not agree on timing:
 *
 *  - The Twilio Device tells us about *our own* audio (mic acquired, joined
 *    the conference, disconnected).
 *  - Supabase Realtime tells us what happened to the *prospects'* legs, which
 *    is what the four line indicators and the connect/disconnect transitions
 *    are actually based on.
 *
 * Deriving phase from the database rather than from the softphone is
 * deliberate: the winner is decided server-side, and the browser finding out
 * about it a beat later is fine. The reverse -- guessing locally who connected
 * -- would drift from the truth the moment a webhook was slow.
 */
export function useDialer() {
  const [phase, setPhase] = useState<DialerPhase>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [liveCall, setLiveCall] = useState<Line | null>(null)
  const [wrapCall, setWrapCall] = useState<Line | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [stats, setStats] = useState({ dialed: 0, connected: 0 })
  const manualRef = useRef(false)

  const linesRef = useRef<Line[]>([])
  const deviceRef = useRef<TwilioDevice | null>(null)
  const connectionRef = useRef<TwilioCall | null>(null)
  const phaseRef = useRef<DialerPhase>('idle')

  // The Twilio 'disconnect' handler is registered once and would otherwise
  // close over the phase at registration time.
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  // Realtime callbacks need the current lines without re-subscribing the
  // channel on every status change.
  useEffect(() => {
    linesRef.current = lines
  }, [lines])

  // --- Realtime: the prospects' legs -------------------------------------

  useEffect(() => {
    if (!sessionId) return

    const supabase = createClient()
    const channel = supabase
      .channel(`dialer:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `session_id=eq.${sessionId}`,
        },
        ({ new: row }) => {
          const call = row as Call

          setLines((current) =>
            current.map((line) =>
              line.callId === call.id ? { ...line, status: call.status } : line,
            ),
          )

          const match = linesRef.current.find((l) => l.callId === call.id)
          if (!match) return

          if (call.status === 'connected' && !call.ended_at) {
            setLiveCall(match)
            setPhase('live')
            setStats((current) => ({ ...current, connected: current.connected + 1 }))
          }

          // The prospect (or we) hung up. Wrap up only a call that actually
          // connected -- a batch of four no-answers should roll straight into
          // the next batch without an exit interview.
          if (call.ended_at && call.status === 'connected') {
            setLiveCall(null)
            setWrapCall(match)
            setPhase('wrapup')
          }
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [sessionId])

  // --- A batch that fully fizzles should roll on by itself ----------------

  const startBatch = useCallback(
    async (id: string) => {
      setError(null)
      manualRef.current = false
      setPhase('dialing')

      try {
        const result = await postJson<BatchResponse>('/api/session/batch', {
          sessionId: id,
        })

        if (result.exhausted || !result.lines?.length) {
          setLines([])
          setPhase('exhausted')
          return
        }

        setLines(result.lines.map((line) => ({ ...line, status: 'dialing' as CallStatus })))
        setStats((s) => ({ ...s, dialed: s.dialed + result.lines!.length }))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start the batch.')
        setPhase('ready')
      }
    },
    [],
  )

  useEffect(() => {
    if (phase !== 'dialing' || lines.length === 0) return
    // A hand-dialed number that nobody answered should hand the agent back the
    // dial pad, not silently start burning through the queue.
    if (manualRef.current) {
      const done = lines.every((line) =>
        ['no_answer', 'busy', 'failed', 'voicemail', 'canceled'].includes(line.status),
      )
      if (done) {
        const timer = setTimeout(() => {
          manualRef.current = false
          setLines([])
          setPhase('ready')
        }, 900)
        return () => clearTimeout(timer)
      }
      return
    }

    const settled = lines.every((line) =>
      ['no_answer', 'busy', 'failed', 'voicemail', 'canceled'].includes(line.status),
    )
    if (!settled || !sessionId) return

    // Every line died without a connect. Give the UI a beat to render the
    // final states, then fan out again.
    const timer = setTimeout(() => void startBatch(sessionId), 900)
    return () => clearTimeout(timer)
  }, [phase, lines, sessionId, startBatch])

  // --- Session lifecycle --------------------------------------------------

  const start = useCallback(async () => {
    setError(null)
    setPhase('connecting')
    setStats({ dialed: 0, connected: 0 })

    try {
      const session = await postJson<{ sessionId: string }>('/api/session/start')

      const tokenResponse = await fetch('/api/twilio/token')
      const { token, error: tokenError } = (await tokenResponse.json()) as {
        token?: string
        error?: string
      }
      if (!token) throw new Error(tokenError ?? 'Could not get a voice token.')

      // Loaded lazily: the Voice SDK touches `window` at import time and would
      // break server rendering.
      const { Device } = await import('@twilio/voice-sdk')
      const device = new Device(token, { logLevel: 'error' })
      deviceRef.current = device

      device.on('error', (deviceError: { message: string }) => {
        setError(deviceError.message)
      })

      const connection = await device.connect({
        params: { sessionId: session.sessionId },
      })
      connectionRef.current = connection

      connection.on('disconnect', () => {
        connectionRef.current = null
        if (phaseRef.current !== 'idle') setPhase('idle')
      })

      setSessionId(session.sessionId)
      setPhase('ready')
      await startBatch(session.sessionId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the session.')
      setPhase('idle')
    }
  }, [startBatch])

  const end = useCallback(async () => {
    const id = sessionId
    connectionRef.current?.disconnect()
    deviceRef.current?.destroy()
    connectionRef.current = null
    deviceRef.current = null

    setPhase('idle')
    setLines([])
    setLiveCall(null)
    setWrapCall(null)
    setSessionId(null)

    if (id) await postJson('/api/session/end', { sessionId: id }).catch(() => undefined)
  }, [sessionId])

  const hangUp = useCallback(async () => {
    if (!liveCall) return
    await postJson(`/api/calls/${liveCall.callId}/hangup`).catch(() => undefined)
  }, [liveCall])

  const toggleMute = useCallback(() => {
    const connection = connectionRef.current
    if (!connection) return
    const next = !muted
    connection.mute(next)
    setMuted(next)
  }, [muted])

  /**
   * Dial one hand-typed number.
   *
   * If no session is running this opens one first, which is what makes the pad
   * usable as a plain phone: the agent should not have to understand that a
   * conference has to exist before a call can be bridged into it.
   */
  const manualDial = useCallback(
    async (phone: string) => {
      setError(null)
      let id = sessionId

      try {
        if (!id) {
          setPhase('connecting')
          const session = await postJson<{ sessionId: string }>('/api/session/start')

          const tokenResponse = await fetch('/api/twilio/token')
          const { token, error: tokenError } = (await tokenResponse.json()) as {
            token?: string
            error?: string
          }
          if (!token) throw new Error(tokenError ?? 'Could not get a voice token.')

          const { Device } = await import('@twilio/voice-sdk')
          const device = new Device(token, { logLevel: 'error' })
          deviceRef.current = device
          device.on('error', (e: { message: string }) => setError(e.message))

          const connection = await device.connect({
            params: { sessionId: session.sessionId },
          })
          connectionRef.current = connection
          connection.on('disconnect', () => {
            connectionRef.current = null
            if (phaseRef.current !== 'idle') setPhase('idle')
          })

          id = session.sessionId
          setSessionId(id)
        }

        manualRef.current = true
        setPhase('dialing')

        const { line } = await postJson<{ line: Omit<Line, 'status'> }>(
          '/api/session/dial',
          { sessionId: id, phone },
        )

        setLines([{ ...line, status: 'dialing' as CallStatus }])
        setStats((s) => ({ ...s, dialed: s.dialed + 1 }))
      } catch (e) {
        manualRef.current = false
        setError(e instanceof Error ? e.message : 'Could not place the call.')
        setPhase(id ? 'ready' : 'idle')
      }
    },
    [sessionId],
  )

  /**
   * Send DTMF into the conference. Phone trees are unavoidable on cold calls --
   * without this the agent hits "press 1 for sales" and is stuck.
   */
  const sendDigits = useCallback((digits: string) => {
    connectionRef.current?.sendDigits(digits)
  }, [])

  const finishWrapup = useCallback(async () => {
    setWrapCall(null)
    if (manualRef.current) {
      manualRef.current = false
      setLines([])
      setPhase('ready')
      return
    }
    if (sessionId) await startBatch(sessionId)
  }, [sessionId, startBatch])

  // Tearing down the tab must not leave a conference and four legs running.
  useEffect(() => {
    return () => {
      connectionRef.current?.disconnect()
      deviceRef.current?.destroy()
    }
  }, [])

  return {
    phase,
    lines,
    liveCall,
    wrapCall,
    error,
    muted,
    stats,
    start,
    manualDial,
    sendDigits,
    end,
    hangUp,
    toggleMute,
    finishWrapup,
    skipBatch: useCallback(async () => {
      await Promise.all(
        lines
          .filter((l) => l.status === 'dialing' || l.status === 'ringing')
          .map((l) => postJson(`/api/calls/${l.callId}/hangup`).catch(() => undefined)),
      )
    }, [lines]),
  }
}
