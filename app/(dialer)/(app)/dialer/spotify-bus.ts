'use client'

import { useEffect, useState } from 'react'

/**
 * Tiny pub/sub so the Spotify deck (at the bottom of the page) and the
 * play/pause button in the dialer header share one player state and one
 * poller. The deck publishes; the header subscribes and asks for refreshes.
 */
export type SpotifyMini = {
  connected: boolean
  isPlaying: boolean
  track: { name: string; artist: string; image: string | null } | null
} | null

let current: SpotifyMini = null
const listeners = new Set<(s: SpotifyMini) => void>()
const refreshers = new Set<() => void>()

export function publishSpotify(s: SpotifyMini) {
  current = s
  for (const l of listeners) l(s)
}

export function onSpotifyRefresh(fn: () => void) {
  refreshers.add(fn)
  return () => {
    refreshers.delete(fn)
  }
}

export function requestSpotifyRefresh() {
  for (const r of refreshers) r()
}

export function useSpotifyMini(): SpotifyMini {
  const [s, setS] = useState<SpotifyMini>(current)
  useEffect(() => {
    listeners.add(setS)
    return () => {
      listeners.delete(setS)
    }
  }, [])
  return s
}
