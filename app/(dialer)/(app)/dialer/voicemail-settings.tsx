'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mic, Square, Trash2, Upload, Voicemail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { startWavRecording, type WavRecording } from './wav-recorder'

const MAX_SECONDS = 60

/**
 * The rep's one pre-recorded voicemail message. Record it here once; during a
 * live call "Leave voicemail" plays it and moves on.
 */
export function VoicemailSettings({ hasVoicemail }: { hasVoicemail: boolean }) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'recording' | 'saving'>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const recordingRef = useRef<WavRecording | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (status !== 'recording') return
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [status])

  useEffect(() => {
    if (status === 'recording' && seconds >= MAX_SECONDS) void stopRecording()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, status])

  async function save(blob: Blob) {
    setStatus('saving')
    setError(null)
    const body = new FormData()
    body.append('file', blob, blob.type === 'audio/mpeg' ? 'voicemail.mp3' : 'voicemail.wav')
    const res = await fetch('/api/voicemail', { method: 'POST', body })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    setStatus('idle')
    if (!res.ok) {
      setError(data.error ?? 'Could not save the message.')
      return
    }
    setVersion((v) => v + 1)
    router.refresh()
  }

  async function startRecording() {
    setError(null)
    try {
      recordingRef.current = await startWavRecording()
      setSeconds(0)
      setStatus('recording')
    } catch {
      setError('Microphone access was refused.')
    }
  }

  async function stopRecording() {
    const rec = recordingRef.current
    recordingRef.current = null
    if (!rec) return
    const blob = await rec.stop()
    await save(blob)
  }

  async function remove() {
    if (!window.confirm('Delete your voicemail message?')) return
    setStatus('saving')
    await fetch('/api/voicemail', { method: 'DELETE' })
    setStatus('idle')
    setVersion((v) => v + 1)
    router.refresh()
  }

  return (
    <section className="w-full max-w-md rounded-lg border border-border-subtle p-4">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
        <Voicemail className="size-4 text-muted" aria-hidden />
        Your voicemail message
      </h2>
      <p className="mt-1 text-xs text-muted">
        {hasVoicemail
          ? 'Press V on a live call to play this and hang up.'
          : 'Record it once. Then, when a call turns out to be a machine, press V and the dialer leaves this for you.'}
      </p>

      {hasVoicemail && status !== 'recording' && (
        <audio
          key={version}
          controls
          preload="none"
          src={`/api/voicemail?v=${version}`}
          className="mt-3 h-9 w-full"
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {status === 'recording' ? (
          <Button variant="danger" onClick={() => void stopRecording()}>
            <Square className="size-3.5" aria-hidden />
            Stop
            <span className="tnum ml-1 font-normal opacity-80">
              0:{String(seconds).padStart(2, '0')}
            </span>
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void startRecording()} disabled={status === 'saving'}>
            <Mic className="size-3.5" aria-hidden />
            {hasVoicemail ? 'Re-record' : 'Record'}
          </Button>
        )}

        <Button onClick={() => fileRef.current?.click()} disabled={status !== 'idle'}>
          <Upload className="size-3.5" aria-hidden />
          Upload WAV or MP3
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/wav,audio/x-wav,audio/mpeg,.wav,.mp3"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void save(f)
          }}
        />

        {hasVoicemail && (
          <Button variant="ghost" onClick={() => void remove()} disabled={status !== 'idle'} className="text-bad hover:text-bad">
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </Button>
        )}

        {status === 'saving' && <span className="text-xs text-muted">Saving…</span>}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-bad">
          {error}
        </p>
      )}
    </section>
  )
}
