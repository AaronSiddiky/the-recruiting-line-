'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, ListMusic, Music, Pause, Play, SkipBack, SkipForward, Unplug } from 'lucide-react'
import { cn } from '@/lib/utils'

type State = {
  connected: boolean
  configured?: boolean
  expired?: boolean
  displayName?: string | null
  isPlaying?: boolean
  progressMs?: number
  durationMs?: number
  track?: { name: string; artist: string; image: string | null } | null
  device?: { id: string; name: string; type: string; volume_percent: number | null } | null
  devices?: { id: string; name: string; type: string; is_active: boolean }[]
  error?: string
}

type Playlist = { id: string; name: string; uri: string; image: string | null; tracks: number | null }

const POLL_MS = 5000

async function control(body: Record<string, unknown>) {
  const res = await fetch('/api/spotify/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Spotify refused that.')
}

function clock(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The rep's own Spotify, controlled through the Web API: what is playing on
 * whichever device they use, play/pause/skip, and their playlists. Audio never
 * touches the call; it plays wherever Spotify is open.
 */
export function SpotifyPanel() {
  const [state, setState] = useState<State | null>(null)
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null)
  const [open, setOpen] = useState(true)
  const [showLists, setShowLists] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/spotify/state', { cache: 'no-store' })
      if (!res.ok) return
      const next = (await res.json()) as State
      setFetchedAt(Date.now())
      setNow(Date.now())
      setState(next)
    } catch {
      // Network blip; the next poll will catch up.
    }
  }, [])

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0)
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [refresh])

  // Smooth progress between polls.
  useEffect(() => {
    if (!state?.isPlaying) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [state?.isPlaying])

  useEffect(() => {
    if (!state?.connected || playlists) return
    fetch('/api/spotify/playlists', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { playlists?: Playlist[] }) => setPlaylists(d.playlists ?? []))
      .catch(() => setPlaylists([]))
  }, [state?.connected, playlists])

  async function run(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await control(body)
      // Spotify takes a beat to reflect a command; poll shortly after.
      setTimeout(() => void refresh(), 400)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Spotify refused that.')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Spotify from the dialer?')) return
    await fetch('/api/spotify', { method: 'DELETE' })
    setPlaylists(null)
    void refresh()
  }

  const progress = state?.isPlaying
    ? Math.min((state.progressMs ?? 0) + (now - fetchedAt), state.durationMs ?? 0)
    : (state?.progressMs ?? 0)

  return (
    <aside
      aria-label="Spotify"
      className="fixed right-4 bottom-4 z-40 w-80 overflow-hidden rounded-lg border border-border-subtle bg-background shadow-lg"
    >
      <div className="flex h-8 items-center gap-2 border-b border-border-subtle px-2.5 text-xs">
        <Music className="size-3.5 text-muted" aria-hidden />
        <span className="font-medium">Spotify</span>
        {state?.displayName && <span className="truncate text-muted">· {state.displayName}</span>}
        <span className="ml-auto flex items-center gap-1">
          {state?.connected && (
            <button
              type="button"
              onClick={() => setShowLists((v) => !v)}
              aria-pressed={showLists}
              title="Playlists"
              aria-label="Playlists"
              className={cn('cursor-pointer rounded p-1 hover:text-foreground', showLists ? 'text-foreground' : 'text-muted-2')}
            >
              <ListMusic className="size-3.5" aria-hidden />
            </button>
          )}
          {state?.connected && (
            <button
              type="button"
              onClick={() => void disconnect()}
              title="Disconnect"
              aria-label="Disconnect Spotify"
              className="cursor-pointer rounded p-1 text-muted-2 hover:text-foreground"
            >
              <Unplug className="size-3.5" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Collapse' : 'Expand'}
            className="cursor-pointer rounded p-1 text-muted-2 hover:text-foreground"
          >
            {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronUp className="size-3.5" aria-hidden />}
          </button>
        </span>
      </div>

      {open && !state && <p className="p-3 text-xs text-muted">Checking Spotify…</p>}

      {open && state && !state.connected && (
        <div className="flex flex-col gap-2 p-3">
          {state.configured === false ? (
            <p className="text-xs text-muted">
              Spotify isn’t set up on this deployment yet. Add <code>SPOTIFY_CLIENT_ID</code> to the environment.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted">
                {state.expired
                  ? 'Your Spotify sign-in expired. Connect again to keep controlling it here.'
                  : 'See what’s playing and control it without leaving the dialer.'}
              </p>
              <a
                href="/api/spotify/login"
                className="inline-flex h-8 items-center justify-center rounded-md bg-[#1DB954] px-3 text-xs font-semibold text-black hover:opacity-90"
              >
                Connect Spotify
              </a>
            </>
          )}
        </div>
      )}

      {open && state?.connected && (
        <div className="p-3">
          {state.track ? (
            <div className="flex items-center gap-3">
              {state.track.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={state.track.image} alt="" className="size-12 shrink-0 rounded" />
              ) : (
                <div className="size-12 shrink-0 rounded bg-surface-2" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{state.track.name}</p>
                <p className="truncate text-xs text-muted">{state.track.artist}</p>
                <div className="mt-1.5 h-1 overflow-hidden rounded bg-surface-2">
                  <div
                    className="h-full bg-foreground/70"
                    style={{ width: state.durationMs ? `${(progress / state.durationMs) * 100}%` : 0 }}
                  />
                </div>
                <p className="tnum mt-0.5 text-[10px] text-muted-2">
                  {clock(progress)} / {clock(state.durationMs ?? 0)}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">
              Nothing playing. Pick a playlist below, or press play in Spotify on your phone or computer.
            </p>
          )}

          <div className="mt-2.5 flex items-center justify-center gap-1">
            <Ctl label="Previous" onClick={() => void run({ action: 'previous' })} disabled={busy}>
              <SkipBack className="size-4" aria-hidden />
            </Ctl>
            <Ctl
              label={state.isPlaying ? 'Pause' : 'Play'}
              onClick={() => void run({ action: state.isPlaying ? 'pause' : 'play' })}
              disabled={busy}
              primary
            >
              {state.isPlaying ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
            </Ctl>
            <Ctl label="Next" onClick={() => void run({ action: 'next' })} disabled={busy}>
              <SkipForward className="size-4" aria-hidden />
            </Ctl>
          </div>

          {(state.devices?.length ?? 0) > 0 && (
            <select
              aria-label="Playback device"
              value={state.device?.id ?? ''}
              onChange={(e) => e.target.value && void run({ action: 'transfer', deviceId: e.target.value })}
              className="mt-2 h-7 w-full rounded-md border border-border-strong bg-background px-1.5 text-xs"
            >
              {!state.device && <option value="">Choose a device…</option>}
              {state.devices!.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.type}
                </option>
              ))}
            </select>
          )}

          {state.device?.volume_percent != null && (
            <input
              type="range"
              min={0}
              max={100}
              defaultValue={state.device.volume_percent}
              aria-label="Volume"
              onMouseUp={(e) => void run({ action: 'volume', percent: Number((e.target as HTMLInputElement).value) })}
              onTouchEnd={(e) => void run({ action: 'volume', percent: Number((e.target as HTMLInputElement).value) })}
              className="mt-2 w-full accent-[#1DB954]"
            />
          )}

          {(error ?? state.error) && (
            <p role="alert" className="mt-2 text-xs text-bad">
              {error ?? state.error}
            </p>
          )}

          {showLists && (
            <ul className="mt-3 max-h-56 overflow-y-auto border-t border-border-subtle pt-2">
              {playlists === null && <li className="text-xs text-muted">Loading playlists…</li>}
              {playlists?.length === 0 && <li className="text-xs text-muted">No playlists on this account.</li>}
              {playlists?.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => void run({ action: 'play', contextUri: p.uri })}
                    disabled={busy}
                    className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-1 text-left hover:bg-surface"
                  >
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="size-7 shrink-0 rounded" />
                    ) : (
                      <div className="size-7 shrink-0 rounded bg-surface-2" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs">{p.name}</span>
                    {p.tracks != null && <span className="tnum text-[10px] text-muted-2">{p.tracks}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  )
}

function Ctl({
  label,
  onClick,
  disabled,
  primary,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center rounded-full disabled:opacity-50',
        primary ? 'size-9 bg-foreground text-background hover:opacity-90' : 'size-8 text-muted hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
