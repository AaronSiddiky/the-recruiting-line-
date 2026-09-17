'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { startWavRecording, type WavRecording } from './wav-recorder'

export const MIC_KEY = 'dialer.micDeviceId'

/**
 * Pick the microphone and hear yourself the way a prospect does.
 *
 * "You sound far away" is almost always the wrong input (the laptop mic
 * while a headset is plugged in) or a Bluetooth headset that dropped into
 * its narrow phone-call mode. A 5-second self-test settles it in the room
 * rather than on a live call.
 */
export function MicSettings({ onChange }: { onChange?: (deviceId: string) => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [chosen, setChosen] = useState('')
  const [status, setStatus] = useState<'idle' | 'recording' | 'playing'>('idle')
  const [clip, setClip] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<WavRecording | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  async function loadDevices() {
    try {
      // Labels are blank until the page has mic permission once.
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()))
      const all = await navigator.mediaDevices.enumerateDevices()
      const mics = all.filter((d) => d.kind === 'audioinput')
      setDevices(mics)
      let saved = ''
      try {
        saved = localStorage.getItem(MIC_KEY) ?? ''
      } catch {
        // Ignore.
      }
      const pick = mics.find((d) => d.deviceId === saved)?.deviceId ?? mics[0]?.deviceId ?? ''
      setChosen(pick)
    } catch {
      setError('Microphone access was refused. Allow it in the browser and reload.')
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void loadDevices(), 0)
    navigator.mediaDevices?.addEventListener?.('devicechange', loadDevices)
    return () => {
      clearTimeout(t)
      navigator.mediaDevices?.removeEventListener?.('devicechange', loadDevices)
    }
  }, [])

  function choose(id: string) {
    setChosen(id)
    try {
      localStorage.setItem(MIC_KEY, id)
    } catch {
      // Ignore.
    }
    onChange?.(id)
  }

  async function record() {
    setError(null)
    setClip(null)
    try {
      recRef.current = await startWavRecording(chosen || undefined)
      setStatus('recording')
      setTimeout(() => void stop(), 5000)
    } catch {
      setError('Could not open that microphone.')
    }
  }

  async function stop() {
    const rec = recRef.current
    recRef.current = null
    if (!rec) return
    const blob = await rec.stop()
    setClip(URL.createObjectURL(blob))
    setStatus('idle')
  }

  const label = (d: MediaDeviceInfo, i: number) => d.label || `Microphone ${i + 1}`
  const bluetooth = devices.find((d) => d.deviceId === chosen && /airpod|bluetooth|bt |wh-|wf-|buds/i.test(d.label))

  return (
    <section className="w-full max-w-md rounded-lg border border-border-subtle p-4">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
        <Mic className="size-4 text-muted" aria-hidden />
        Your microphone
      </h2>
      <p className="mt-1 text-xs text-muted">
        Pick the mic you actually talk into, then record five seconds and listen. That is what the prospect hears.
      </p>

      <select
        value={chosen}
        onChange={(e) => choose(e.target.value)}
        aria-label="Microphone"
        className="mt-3 h-8 w-full rounded-md border border-border-strong bg-background px-2 text-sm"
      >
        {devices.length === 0 && <option value="">No microphones found</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>{label(d, i)}</option>
        ))}
      </select>

      {bluetooth && (
        <p className="mt-2 rounded-md bg-warn-bg px-2.5 py-1.5 text-xs text-warn">
          Bluetooth headsets switch to a low-quality phone-call mode when their mic is used, which is the classic
          &ldquo;talking from a ditch&rdquo; sound. A wired headset or the laptop mic with wired earbuds sounds much better to the other side.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {status === 'recording' ? (
          <Button variant="danger" onClick={() => void stop()}>
            <Square className="size-3.5" aria-hidden />
            Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void record()} disabled={!chosen}>
            <Mic className="size-3.5" aria-hidden />
            Record 5s test
          </Button>
        )}
        {clip && (
          <Button onClick={() => audioRef.current?.play()}>
            <Play className="size-3.5" aria-hidden />
            Play it back
          </Button>
        )}
        {clip && <audio ref={audioRef} src={clip} className="hidden" />}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-bad">{error}</p>}
    </section>
  )
}
