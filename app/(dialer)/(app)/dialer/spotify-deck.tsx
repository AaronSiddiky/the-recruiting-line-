'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ListMusic,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Unplug,
  Volume2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TrackView } from '@/lib/spotify/views'

type State = {
  connected: boolean
  configured?: boolean
  expired?: boolean
  displayName?: string | null
  isPlaying?: boolean
  progressMs?: number
  shuffle?: boolean
  repeat?: 'off' | 'context' | 'track'
  contextUri?: string | null
  track?: TrackView | null
  device?: { id: string; name: string; type: string; volume_percent: number | null } | null
  devices?: { id: string; name: string; type: string; is_active: boolean }[]
  error?: string
}
type Playlist = { id: string; name: string; uri: string; image: string | null; tracks: number | null; by?: string | null }
type SearchResult = { tracks: TrackView[]; playlists: Playlist[]; albums: Playlist[] }

const POLL_MS = 4000

async function api<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Spotify refused that.')
  return data
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Full Spotify deck under the dialer: the rep's playlists, a track list or
 * search results, and a now-playing panel with transport, seek, shuffle,
 * repeat, volume, device switching and the queue. Audio plays wherever
 * Spotify is open; nothing here touches the call.
 */
export function SpotifyDeck() {
  const [state, setState] = useState<State | null>(null)
  const [callback, setCallback] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null)
  const [selected, setSelected] = useState<Playlist | null>(null)
  const [tracks, setTracks] = useState<TrackView[] | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult | null>(null)
  const [queue, setQueue] = useState<TrackView[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seeking, setSeeking] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await api<State>('/api/spotify/state')
      setFetchedAt(Date.now())
      setNow(Date.now())
      setState(next)
    } catch {
      // Network blip; the next poll catches up.
    }
  }, [])

  // The sign-in round trip lands on /dialer?spotify=…; surface the result once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('spotify')
    if (!result) return
    const reason = params.get('reason')
    const text =
      result === 'connected'
        ? null
        : result === 'denied'
          ? `Spotify did not authorize the dialer${reason ? `: ${reason}` : '.'}`
          : `Connecting failed${reason ? `: ${reason}` : '.'}`
    queueMicrotask(() => setCallback(text))
    params.delete('spotify')
    params.delete('reason')
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`)
  }, [])

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0)
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [refresh])

  useEffect(() => {
    if (!state?.isPlaying) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [state?.isPlaying])

  useEffect(() => {
    if (!state?.connected || playlists) return
    api<{ playlists: Playlist[] }>('/api/spotify/playlists')
      .then((d) => setPlaylists(d.playlists))
      .catch(() => setPlaylists([]))
  }, [state?.connected, playlists])

  // Queue changes with every track; refetch when the track does.
  const trackUri = state?.track?.uri
  useEffect(() => {
    if (!state?.connected) return
    api<{ queue: TrackView[] }>('/api/spotify/queue')
      .then((d) => setQueue(d.queue))
      .catch(() => undefined)
  }, [state?.connected, trackUri])

  useEffect(() => {
    if (!selected) return
    let stale = false
    api<{ tracks: TrackView[] }>(`/api/spotify/playlists/${selected.id}/tracks`)
      .then((d) => !stale && setTracks(d.tracks))
      .catch(() => !stale && setTracks([]))
    return () => {
      stale = true
    }
  }, [selected])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      const t = setTimeout(() => setResults(null), 0)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      api<SearchResult>(`/api/spotify/search?q=${encodeURIComponent(q)}`)
        .then(setResults)
        .catch(() => setResults({ tracks: [], playlists: [], albums: [] }))
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  async function run(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await api('/api/spotify/control', body)
      setTimeout(() => void refresh(), 500)
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
    setSelected(null)
    void refresh()
  }

  const duration = state?.track?.durationMs ?? 0
  const progress =
    seeking ?? (state?.isPlaying ? Math.min((state.progressMs ?? 0) + (now - fetchedAt), duration) : (state?.progressMs ?? 0))

  return (
    <section aria-label="Spotify" className="mt-10 rounded-lg border border-border-subtle bg-background">
      <header className="flex h-10 items-center gap-2 border-b border-border-subtle px-4 text-sm">
        <Music className="size-4 text-[#1DB954]" aria-hidden />
        <span className="font-semibold">Spotify</span>
        {state?.displayName && <span className="text-muted">· {state.displayName}</span>}
        {state?.device && (
          <span className="ml-3 hidden text-xs text-muted-2 md:inline">
            Playing on {state.device.name}
          </span>
        )}
        {state?.connected && (
          <button
            type="button"
            onClick={() => void disconnect()}
            className="ml-auto inline-flex cursor-pointer items-center gap-1 text-xs text-muted-2 hover:text-foreground"
          >
            <Unplug className="size-3.5" aria-hidden />
            Disconnect
          </button>
        )}
      </header>

      {callback && (
        <p role="alert" className="border-b border-bad-bg bg-bad-bg px-4 py-2 text-xs text-bad">
          {callback}
        </p>
      )}

      {!state && <p className="p-4 text-sm text-muted">Checking Spotify…</p>}

      {state && !state.connected && (
        <div className="flex flex-col items-start gap-3 p-4">
          {state.configured === false ? (
            <p className="text-sm text-muted">
              Spotify isn’t set up on this deployment. Add <code>SPOTIFY_CLIENT_ID</code> to the environment.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">
                {state.expired
                  ? 'Your Spotify sign-in expired. Connect again to keep controlling it here.'
                  : 'Your playlists, what’s playing, and the controls, without leaving the dialer.'}
              </p>
              <a
                href="/api/spotify/login"
                className="inline-flex h-9 items-center rounded-full bg-[#1DB954] px-5 text-sm font-semibold text-black hover:opacity-90"
              >
                Connect Spotify
              </a>
            </>
          )}
        </div>
      )}

      {state?.connected && (
        <div className="grid min-h-[420px] grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
          {/* Playlists */}
          <aside className="border-b border-border-subtle lg:border-r lg:border-b-0">
            <p className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-xs font-medium text-muted">
              <ListMusic className="size-3.5" aria-hidden />
              Your playlists
            </p>
            <ul className="max-h-[520px] overflow-y-auto px-1.5 pb-2">
              {playlists === null && <li className="px-2 py-1 text-xs text-muted">Loading…</li>}
              {playlists?.length === 0 && <li className="px-2 py-1 text-xs text-muted">No playlists yet.</li>}
              {playlists?.map((p) => {
                const playing = state.contextUri === p.uri
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(p)
                        setTracks(null)
                        setQuery('')
                      }}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface',
                        selected?.id === p.id && 'bg-surface-2',
                      )}
                    >
                      <Art src={p.image} size="size-9" />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-sm', playing && 'text-[#1DB954]')}>{p.name}</span>
                        {p.tracks != null && <span className="tnum block text-[11px] text-muted-2">{p.tracks} songs</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          {/* Tracks / search */}
          <div className="flex min-w-0 flex-col border-b border-border-subtle lg:border-r lg:border-b-0">
            <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
              <Search className="size-4 text-muted-2" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search songs, albums, playlists"
                aria-label="Search Spotify"
                className="h-8 min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-2 focus:outline-none"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="cursor-pointer text-xs text-muted hover:text-foreground">
                  Clear
                </button>
              )}
            </div>

            <div className="max-h-[520px] overflow-y-auto">
              {results ? (
                <div className="p-2">
                  <Group title="Songs">
                    {results.tracks.map((t) => (
                      <TrackRow
                        key={t.uri}
                        track={t}
                        active={t.uri === state.track?.uri}
                        onPlay={() => void run({ action: 'play', uris: [t.uri] })}
                        onQueue={() => void run({ action: 'queue', uri: t.uri })}
                      />
                    ))}
                  </Group>
                  <Group title="Playlists">
                    {results.playlists.map((p) => (
                      <ContextRow key={p.id} item={p} onPlay={() => void run({ action: 'play', contextUri: p.uri })} onOpen={() => { setSelected(p); setTracks(null); setQuery('') }} />
                    ))}
                  </Group>
                  <Group title="Albums">
                    {results.albums.map((a) => (
                      <ContextRow key={a.id} item={a} onPlay={() => void run({ action: 'play', contextUri: a.uri })} />
                    ))}
                  </Group>
                  {results.tracks.length + results.playlists.length + results.albums.length === 0 && (
                    <p className="px-2 py-4 text-sm text-muted">Nothing found.</p>
                  )}
                </div>
              ) : selected ? (
                <div>
                  <div className="flex items-center gap-3 px-3 py-3">
                    <Art src={selected.image} size="size-14" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold">{selected.name}</p>
                      {selected.tracks != null && <p className="tnum text-xs text-muted">{selected.tracks} songs</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => void run({ action: 'play', contextUri: selected.uri })}
                      disabled={busy}
                      className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full bg-[#1DB954] text-black hover:opacity-90 disabled:opacity-50"
                      aria-label={`Play ${selected.name}`}
                    >
                      <Play className="size-4" aria-hidden />
                    </button>
                  </div>
                  <ol className="px-2 pb-2">
                    {tracks === null && <li className="px-2 py-1 text-xs text-muted">Loading…</li>}
                    {tracks?.map((t, i) => (
                      <TrackRow
                        key={`${t.uri}:${i}`}
                        index={i + 1}
                        track={t}
                        active={t.uri === state.track?.uri}
                        onPlay={() => void run({ action: 'play', contextUri: selected.uri, offsetUri: t.uri })}
                        onQueue={() => void run({ action: 'queue', uri: t.uri })}
                      />
                    ))}
                  </ol>
                </div>
              ) : (
                <p className="px-4 py-8 text-center text-sm text-muted">
                  Pick a playlist on the left, or search.
                </p>
              )}
            </div>
          </div>

          {/* Now playing */}
          <aside className="flex flex-col p-4">
            {state.track ? (
              <>
                <Art src={state.track.imageLarge ?? state.track.image} size="aspect-square w-full" rounded="rounded-md" />
                <p className="mt-3 truncate text-base font-semibold" title={state.track.name}>{state.track.name}</p>
                <p className="truncate text-sm text-muted">{state.track.artist}</p>
                <p className="truncate text-xs text-muted-2">{state.track.album}</p>

                <input
                  type="range"
                  min={0}
                  max={duration || 1}
                  value={Math.min(progress, duration || 1)}
                  onChange={(e) => setSeeking(Number(e.target.value))}
                  onMouseUp={() => {
                    if (seeking != null) void run({ action: 'seek', positionMs: seeking })
                    setSeeking(null)
                  }}
                  onTouchEnd={() => {
                    if (seeking != null) void run({ action: 'seek', positionMs: seeking })
                    setSeeking(null)
                  }}
                  aria-label="Seek"
                  className="mt-3 w-full accent-[#1DB954]"
                />
                <div className="tnum flex justify-between text-[11px] text-muted-2">
                  <span>{clock(progress)}</span>
                  <span>{clock(duration)}</span>
                </div>
              </>
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-md bg-surface-2 text-sm text-muted">
                Nothing playing
              </div>
            )}

            <div className="mt-3 flex items-center justify-center gap-2">
              <Ctl label={state.shuffle ? 'Shuffle on' : 'Shuffle off'} on={state.shuffle} onClick={() => void run({ action: 'shuffle', state: !state.shuffle })} disabled={busy}>
                <Shuffle className="size-4" aria-hidden />
              </Ctl>
              <Ctl label="Previous" onClick={() => void run({ action: 'previous' })} disabled={busy}>
                <SkipBack className="size-5" aria-hidden />
              </Ctl>
              <Ctl label={state.isPlaying ? 'Pause' : 'Play'} onClick={() => void run({ action: state.isPlaying ? 'pause' : 'play' })} disabled={busy} primary>
                {state.isPlaying ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
              </Ctl>
              <Ctl label="Next" onClick={() => void run({ action: 'next' })} disabled={busy}>
                <SkipForward className="size-5" aria-hidden />
              </Ctl>
              <Ctl
                label={`Repeat: ${state.repeat ?? 'off'}`}
                on={state.repeat !== 'off'}
                onClick={() => void run({ action: 'repeat', state: state.repeat === 'off' ? 'context' : state.repeat === 'context' ? 'track' : 'off' })}
                disabled={busy}
              >
                {state.repeat === 'track' ? <Repeat1 className="size-4" aria-hidden /> : <Repeat className="size-4" aria-hidden />}
              </Ctl>
            </div>

            {state.device?.volume_percent != null && (
              <label className="mt-3 flex items-center gap-2 text-muted-2">
                <Volume2 className="size-4" aria-hidden />
                <input
                  type="range"
                  min={0}
                  max={100}
                  defaultValue={state.device.volume_percent}
                  aria-label="Volume"
                  onMouseUp={(e) => void run({ action: 'volume', percent: Number((e.target as HTMLInputElement).value) })}
                  onTouchEnd={(e) => void run({ action: 'volume', percent: Number((e.target as HTMLInputElement).value) })}
                  className="w-full accent-[#1DB954]"
                />
              </label>
            )}

            {(state.devices?.length ?? 0) > 0 && (
              <select
                aria-label="Playback device"
                value={state.device?.id ?? ''}
                onChange={(e) => e.target.value && void run({ action: 'transfer', deviceId: e.target.value })}
                className="mt-3 h-8 w-full rounded-md border border-border-strong bg-background px-2 text-xs"
              >
                {!state.device && <option value="">Choose a device…</option>}
                {state.devices!.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.type}
                  </option>
                ))}
              </select>
            )}

            {(error ?? state.error) && (
              <p role="alert" className="mt-3 text-xs text-bad">
                {error ?? state.error}
              </p>
            )}

            {queue.length > 0 && (
              <div className="mt-4 min-h-0">
                <p className="mb-1 text-xs font-medium text-muted">Up next</p>
                <ul className="max-h-40 overflow-y-auto">
                  {queue.map((t, i) => (
                    <li key={`${t.uri}:${i}`} className="flex items-center gap-2 py-1">
                      <Art src={t.image} size="size-7" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs">{t.name}</span>
                        <span className="block truncate text-[11px] text-muted-2">{t.artist}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}

function Art({ src, size, rounded = 'rounded' }: { src: string | null; size: string; rounded?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={cn('shrink-0 object-cover', size, rounded)} />
  ) : (
    <div className={cn('shrink-0 bg-surface-2', size, rounded)} />
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode[] }) {
  if (children.length === 0) return null
  return (
    <div className="mb-2">
      <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted">{title}</p>
      {children}
    </div>
  )
}

function TrackRow({
  track,
  index,
  active,
  onPlay,
  onQueue,
}: {
  track: TrackView
  index?: number
  active: boolean
  onPlay: () => void
  onQueue: () => void
}) {
  return (
    <li className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface">
      <button type="button" onClick={onPlay} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
        {index != null ? (
          <span className={cn('tnum w-5 shrink-0 text-right text-xs', active ? 'text-[#1DB954]' : 'text-muted-2')}>{index}</span>
        ) : (
          <Art src={track.image} size="size-8" />
        )}
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm', active && 'text-[#1DB954]')}>{track.name}</span>
          <span className="block truncate text-xs text-muted">{track.artist}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onQueue}
        title="Add to queue"
        className="cursor-pointer rounded px-1.5 text-[11px] text-muted-2 opacity-0 hover:text-foreground group-hover:opacity-100"
      >
        + Queue
      </button>
      <span className="tnum w-10 shrink-0 text-right text-xs text-muted-2">{clock(track.durationMs)}</span>
    </li>
  )
}

function ContextRow({ item, onPlay, onOpen }: { item: Playlist; onPlay: () => void; onOpen?: () => void }) {
  return (
    <li className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface">
      <button type="button" onClick={onOpen ?? onPlay} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
        <Art src={item.image} size="size-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{item.name}</span>
          {item.by && <span className="block truncate text-xs text-muted">{item.by}</span>}
        </span>
      </button>
      <button type="button" onClick={onPlay} aria-label={`Play ${item.name}`} className="cursor-pointer rounded-full p-1.5 text-muted-2 opacity-0 hover:text-foreground group-hover:opacity-100">
        <Play className="size-3.5" aria-hidden />
      </button>
    </li>
  )
}

function Ctl({
  label,
  onClick,
  disabled,
  primary,
  on,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  on?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={on}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center rounded-full disabled:opacity-50',
        primary ? 'size-11 bg-foreground text-background hover:opacity-90' : 'size-9 hover:text-foreground',
        !primary && (on ? 'text-[#1DB954]' : 'text-muted'),
      )}
    >
      {children}
    </button>
  )
}
