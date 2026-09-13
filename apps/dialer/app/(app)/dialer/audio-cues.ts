'use client'

/**
 * Short tones for the moments an agent must not miss while looking at another
 * window: someone picked up, someone hung up. Synthesized rather than loaded,
 * so nothing has to be fetched in the half second that matters.
 *
 * Browsers only allow audio after a user gesture, so `primeAudio` is called
 * from the Start and Call buttons.
 */
let context: AudioContext | null = null

export function primeAudio() {
  if (typeof window === 'undefined') return
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return
  context ??= new Ctor()
  if (context.state === 'suspended') void context.resume()
}

const CUES = {
  connect: [660, 880],
  hangup: [620, 415],
  voicemail: [520, 520],
} as const

export function playCue(kind: keyof typeof CUES) {
  const ctx = context
  if (!ctx) return
  const start = ctx.currentTime + 0.01
  CUES[kind].forEach((frequency, index) => {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    const at = start + index * 0.14
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.08, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12)
    oscillator.connect(gain).connect(ctx.destination)
    oscillator.start(at)
    oscillator.stop(at + 0.13)
  })
}
