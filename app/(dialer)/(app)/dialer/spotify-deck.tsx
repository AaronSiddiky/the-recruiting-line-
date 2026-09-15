'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  Heart,
  Home,
  ListMusic,
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
  scopesOk?: boolean
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
type Artist = { id: string; name: string; uri: string; image: string | null }
type HomeData = {
  playlists: Playlist[]
  madeForYou: Playlist[]
  topArtists: Artist[]
  topTracks: TrackView[]
  recent: TrackView[]
  liked: { total: number; tracks: TrackView[] }
}
type SearchResult = { tracks: TrackView[]; playlists: Playlist[]; albums: Playlist[] }
type View = { kind: 'home' } | { kind: 'playlist'; playlist: Playlist } | { kind: 'liked' }

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
 * Spotify under the dialer, laid out like Spotify's own home: shortcut tiles,
 * "Made for you", top artists, recently played, playlists, plus a player bar.
 * The real web player cannot be embedded (Spotify forbids framing), so this
 * drives the rep's Spotify through the Web API instead. Audio plays wherever
 * Spotify is open and never touches the call.
 */
export function SpotifyDeck() {
  const [state, setState] = useState<State | null>(null)
  const [callback, setCallback] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [home, setHome] = useState<HomeData | null>(null)
  const [view, setView] = useState<View>({ kind: 'home' })
  const [tracks, setTracks] = useState<TrackView[] | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult | null>(null)
  const [queue, setQueue] = useState<TrackView[]>([])
  const [showQueue, setShowQueue] = useState(false)
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

  const connected = !!state?.connected && state.scopesOk !== false
  useEffect(() => {
    if (!connected || home) return
    api<HomeData>('/api/spotify/home')
      .then(setHome)
      .catch(() => setHome({ playlists: [], madeForYou: [], topArtists: [], topTracks: [], recent: [], liked: { total: 0, tracks: [] } }))
  }, [connected, home])

  const trackUri = state?.track?.uri
  useEffect(() => {
    if (!connected) return
    api<{ queue: TrackView[] }>('/api/spotify/queue')
      .then((d) => setQueue(d.queue))
      .catch(() => undefined)
  }, [connected, trackUri])

  useEffect(() => {
    if (view.kind !== 'playlist') return
    let stale = false
    api<{ tracks: TrackView[] }>(`/api/spotify/playlists/${view.playlist.id}/tracks`)
      .then((d) => !stale && setTracks(d.tracks))
      .catch(() => !stale && setTracks([]))
    return () => {
      stale = true
    }
  }, [view])

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

  function open(next: View) {
    setTracks(null)
    setQuery('')
    setView(next)
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Spotify from the dialer?')) return
    await fetch('/api/spotify', { method: 'DELETE' })
    setHome(null)
    setView({ kind: 'home' })
    void refresh()
  }

  const playLiked = (from?: TrackView) => {
    const uris = home?.liked.tracks.map((t) => t.uri) ?? []
    if (!uris.length) return
    const start = from ? uris.indexOf(from.uri) : 0
    void run({ action: 'play', uris: uris.slice(Math.max(0, start)).concat(uris.slice(0, Math.max(0, start))) })
  }

  const duration = state?.track?.durationMs ?? 0
  const progress =
    seeking ?? (state?.isPlaying ? Math.min((state.progressMs ?? 0) + (now - fetchedAt), duration) : (state?.progressMs ?? 0))
  const first = state?.displayName?.split(' ')[0] ?? 'you'

  return (
    <section
      aria-label="Spotify"
      className="mt-10 overflow-hidden rounded-xl bg-[#121212] text-[#f5f5f5] shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
      style={{ colorScheme: 'dark' }}
    >
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3">
        <SpotifyMark />
        <button
          type="button"
          onClick={() => open({ kind: 'home' })}
          aria-label="Home"
          className={cn('inline-flex size-9 cursor-pointer items-center justify-center rounded-full bg-[#1f1f1f] hover:bg-[#2a2a2a]', view.kind === 'home' && !results && 'text-white')}
        >
          <Home className="size-4" aria-hidden />
        </button>
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-[#1f1f1f] px-4 text-sm hover:bg-[#2a2a2a] md:max-w-md">
          <Search className="size-4 shrink-0 text-[#b3b3b3]" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What do you want to play?"
            aria-label="Search Spotify"
            className="min-w-0 flex-1 bg-transparent placeholder:text-[#b3b3b3] focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="cursor-pointer text-xs text-[#b3b3b3] hover:text-white">
              Clear
            </button>
          )}
        </label>
        <span className="ml-auto hidden items-center gap-3 text-xs text-[#b3b3b3] md:flex">
          {state?.device && <span>Playing on {state.device.name}</span>}
          {state?.displayName && <span className="font-medium text-white">{state.displayName}</span>}
          {state?.connected && (
            <button type="button" onClick={() => void disconnect()} title="Disconnect" aria-label="Disconnect Spotify" className="cursor-pointer hover:text-white">
              <Unplug className="size-4" aria-hidden />
            </button>
          )}
        </span>
      </div>

      {callback && <p role="alert" className="bg-[#e91429]/20 px-4 py-2 text-xs text-[#f15e6c]">{callback}</p>}

      {/* Body */}
      <div className="min-h-[560px]">
        {!state && <p className="p-6 text-sm text-[#b3b3b3]">Checking Spotify…</p>}

        {state && (!state.connected || state.scopesOk === false) && (
          <div className="flex flex-col items-start gap-4 p-6">
            {state.configured === false ? (
              <p className="text-sm text-[#b3b3b3]">
                Spotify isn’t set up on this deployment. Add <code>SPOTIFY_CLIENT_ID</code> to the environment.
              </p>
            ) : (
              <>
                <h2 className="text-2xl font-bold">
                  {state.scopesOk === false ? 'Reconnect to unlock your home' : state.expired ? 'Your Spotify sign-in expired' : 'Bring your Spotify into the dialer'}
                </h2>
                <p className="max-w-lg text-sm text-[#b3b3b3]">
                  {state.scopesOk === false
                    ? 'The home view needs three more permissions than your first sign-in granted: recently played, liked songs, and your top artists. Reconnecting takes ten seconds.'
                    : 'Your playlists, liked songs, recently played, and full playback controls, right here.'}
                </p>
                <a
                  href="/api/spotify/login"
                  className="inline-flex h-11 items-center rounded-full bg-[#1DB954] px-7 text-sm font-bold text-black hover:scale-[1.03]"
                >
                  {state.scopesOk === false ? 'Reconnect Spotify' : 'Connect Spotify'}
                </a>
              </>
            )}
          </div>
        )}

        {connected && (
          <div className="flex">
            <div className="min-w-0 flex-1 px-5 pb-6">
              {results ? (
                <SearchView results={results} active={state!.track?.uri} onPlayTrack={(t) => void run({ action: 'play', uris: [t.uri] })} onQueue={(t) => void run({ action: 'queue', uri: t.uri })} onPlayContext={(uri) => void run({ action: 'play', contextUri: uri })} onOpen={(p) => open({ kind: 'playlist', playlist: p })} />
              ) : view.kind === 'home' ? (
                <HomeView
                  home={home}
                  first={first}
                  contextUri={state!.contextUri ?? null}
                  onOpen={(p) => open({ kind: 'playlist', playlist: p })}
                  onOpenLiked={() => open({ kind: 'liked' })}
                  onPlayContext={(uri) => void run({ action: 'play', contextUri: uri })}
                  onPlayTrack={(t) => void run({ action: 'play', uris: [t.uri] })}
                />
              ) : view.kind === 'liked' ? (
                <ListView
                  title="Liked Songs"
                  subtitle={home ? `${home.liked.total.toLocaleString()} songs` : ''}
                  art={<div className="flex size-28 items-center justify-center rounded bg-gradient-to-br from-[#4c1fd1] to-[#b3b3d1]"><Heart className="size-10 fill-white text-white" aria-hidden /></div>}
                  tracks={home?.liked.tracks ?? null}
                  active={state!.track?.uri}
                  busy={busy}
                  onBack={() => open({ kind: 'home' })}
                  onPlayAll={() => playLiked()}
                  onPlayTrack={(t) => playLiked(t)}
                  onQueue={(t) => void run({ action: 'queue', uri: t.uri })}
                />
              ) : (
                <ListView
                  title={view.playlist.name}
                  subtitle={[view.playlist.by, view.playlist.tracks != null ? `${view.playlist.tracks} songs` : null].filter(Boolean).join(' · ')}
                  art={<Art src={view.playlist.image} className="size-28 rounded" />}
                  tracks={tracks}
                  active={state!.track?.uri}
                  busy={busy}
                  onBack={() => open({ kind: 'home' })}
                  onPlayAll={() => void run({ action: 'play', contextUri: view.playlist.uri })}
                  onPlayTrack={(t) => void run({ action: 'play', contextUri: view.playlist.uri, offsetUri: t.uri })}
                  onQueue={(t) => void run({ action: 'queue', uri: t.uri })}
                />
              )}
            </div>

            {showQueue && (
              <aside className="hidden w-72 shrink-0 border-l border-white/10 p-4 lg:block">
                <p className="mb-3 text-base font-bold">Queue</p>
                {state!.track && (
                  <>
                    <p className="mb-1 text-xs text-[#b3b3b3]">Now playing</p>
                    <Row track={state!.track} active />
                  </>
                )}
                <p className="mt-3 mb-1 text-xs text-[#b3b3b3]">Next up</p>
                {queue.length === 0 && <p className="text-xs text-[#b3b3b3]">Nothing queued.</p>}
                {queue.map((t, i) => <Row key={`${t.uri}:${i}`} track={t} />)}
              </aside>
            )}
          </div>
        )}
      </div>

      {/* Player bar */}
      {connected && (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-t border-white/10 bg-black px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {state!.track ? (
              <>
                <Art src={state!.track.image} className="size-14 rounded" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={state!.track.name}>{state!.track.name}</p>
                  <p className="truncate text-xs text-[#b3b3b3]">{state!.track.artist}</p>
                </div>
              </>
            ) : (
              <p className="text-xs text-[#b3b3b3]">Nothing playing. Pick something above, or press play in Spotify.</p>
            )}
          </div>

          <div className="flex w-[min(520px,50vw)] flex-col items-center gap-1">
            <div className="flex items-center gap-3">
              <Ctl label={state!.shuffle ? 'Shuffle on' : 'Shuffle off'} on={state!.shuffle} onClick={() => void run({ action: 'shuffle', state: !state!.shuffle })} disabled={busy}><Shuffle className="size-4" aria-hidden /></Ctl>
              <Ctl label="Previous" onClick={() => void run({ action: 'previous' })} disabled={busy}><SkipBack className="size-5 fill-current" aria-hidden /></Ctl>
              <Ctl label={state!.isPlaying ? 'Pause' : 'Play'} onClick={() => void run({ action: state!.isPlaying ? 'pause' : 'play' })} disabled={busy} primary>
                {state!.isPlaying ? <Pause className="size-5 fill-current" aria-hidden /> : <Play className="size-5 fill-current" aria-hidden />}
              </Ctl>
              <Ctl label="Next" onClick={() => void run({ action: 'next' })} disabled={busy}><SkipForward className="size-5 fill-current" aria-hidden /></Ctl>
              <Ctl label={`Repeat: ${state!.repeat ?? 'off'}`} on={state!.repeat !== 'off'} onClick={() => void run({ action: 'repeat', state: state!.repeat === 'off' ? 'context' : state!.repeat === 'context' ? 'track' : 'off' })} disabled={busy}>
                {state!.repeat === 'track' ? <Repeat1 className="size-4" aria-hidden /> : <Repeat className="size-4" aria-hidden />}
              </Ctl>
            </div>
            <div className="tnum flex w-full items-center gap-2 text-[11px] text-[#b3b3b3]">
              <span>{clock(progress)}</span>
              <input
                type="range"
                min={0}
                max={duration || 1}
                value={Math.min(progress, duration || 1)}
                onChange={(e) => setSeeking(Number(e.target.value))}
                onMouseUp={() => { if (seeking != null) void run({ action: 'seek', positionMs: seeking }); setSeeking(null) }}
                onTouchEnd={() => { if (seeking != null) void run({ action: 'seek', positionMs: seeking }); setSeeking(null) }}
                aria-label="Seek"
                disabled={!state!.track}
                className="h-1 w-full accent-white"
              />
              <span>{clock(duration)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowQueue((v) => !v)}
              aria-pressed={showQueue}
              title="Queue"
              aria-label="Queue"
              className={cn('hidden cursor-pointer lg:inline-flex', showQueue ? 'text-[#1DB954]' : 'text-[#b3b3b3] hover:text-white')}
            >
              <ListMusic className="size-4" aria-hidden />
            </button>
            {(state!.devices?.length ?? 0) > 0 && (
              <select
                aria-label="Playback device"
                value={state!.device?.id ?? ''}
                onChange={(e) => e.target.value && void run({ action: 'transfer', deviceId: e.target.value })}
                className="hidden h-7 max-w-40 truncate rounded bg-[#1f1f1f] px-2 text-xs text-[#b3b3b3] md:block"
              >
                {!state!.device && <option value="">Choose a device…</option>}
                {state!.devices!.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
            {state!.device?.volume_percent != null && (
              <span className="flex items-center gap-1.5 text-[#b3b3b3]">
                <Volume2 className="size-4" aria-hidden />
                <input
                  type="range" min={0} max={100} defaultValue={state!.device.volume_percent} aria-label="Volume"
                  onMouseUp={(e) => void run({ action: 'volume', percent: Number((e.target as HTMLInputElement).value) })}
                  onTouchEnd={(e) => void run({ action: 'volume', percent: Number((e.target as HTMLInputElement).value) })}
                  className="h-1 w-24 accent-white"
                />
              </span>
            )}
          </div>
          {(error ?? state!.error) && (
            <p role="alert" className="col-span-3 text-xs text-[#f15e6c]">{error ?? state!.error}</p>
          )}
        </div>
      )}
    </section>
  )
}

/* ---------- views ---------- */

function HomeView({ home, first, contextUri, onOpen, onOpenLiked, onPlayContext, onPlayTrack }: {
  home: HomeData | null
  first: string
  contextUri: string | null
  onOpen: (p: Playlist) => void
  onOpenLiked: () => void
  onPlayContext: (uri: string) => void
  onPlayTrack: (t: TrackView) => void
}) {
  if (!home) return <p className="py-6 text-sm text-[#b3b3b3]">Loading your Spotify…</p>
  const shortcuts = home.playlists.slice(0, 7)
  return (
    <div className="space-y-8 pt-2">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Tile onClick={onOpenLiked} art={<div className="flex size-14 items-center justify-center bg-gradient-to-br from-[#4c1fd1] to-[#b3b3d1]"><Heart className="size-6 fill-white text-white" aria-hidden /></div>} label="Liked Songs" playing={false} onPlay={undefined} />
        {shortcuts.map((p) => (
          <Tile key={p.id} onClick={() => onOpen(p)} art={<Art src={p.image} className="size-14" />} label={p.name} playing={contextUri === p.uri} onPlay={() => onPlayContext(p.uri)} />
        ))}
      </div>

      {home.madeForYou.length > 0 && (
        <Shelf eyebrow="Made For" title={first}>
          {home.madeForYou.map((p) => <Card key={p.id} image={p.image} title={p.name} subtitle={p.by ?? ''} onClick={() => onOpen(p)} onPlay={() => onPlayContext(p.uri)} playing={contextUri === p.uri} />)}
        </Shelf>
      )}

      {home.topArtists.length > 0 && (
        <Shelf title="Your top artists">
          {home.topArtists.map((a) => <Card key={a.id} image={a.image} title={a.name} subtitle="Artist" round onPlay={() => onPlayContext(a.uri)} playing={contextUri === a.uri} />)}
        </Shelf>
      )}

      {home.recent.length > 0 && (
        <Shelf title="Recently played">
          {home.recent.map((t) => <Card key={t.uri} image={t.image} title={t.name} subtitle={t.artist} onPlay={() => onPlayTrack(t)} playing={false} />)}
        </Shelf>
      )}

      {home.topTracks.length > 0 && (
        <Shelf title="Your top songs">
          {home.topTracks.map((t) => <Card key={t.uri} image={t.image} title={t.name} subtitle={t.artist} onPlay={() => onPlayTrack(t)} playing={false} />)}
        </Shelf>
      )}

      {home.playlists.length > 0 && (
        <Shelf title="Your playlists">
          {home.playlists.map((p) => <Card key={p.id} image={p.image} title={p.name} subtitle={p.tracks != null ? `${p.tracks} songs` : (p.by ?? '')} onClick={() => onOpen(p)} onPlay={() => onPlayContext(p.uri)} playing={contextUri === p.uri} />)}
        </Shelf>
      )}
    </div>
  )
}

function SearchView({ results, active, onPlayTrack, onQueue, onPlayContext, onOpen }: {
  results: SearchResult
  active?: string
  onPlayTrack: (t: TrackView) => void
  onQueue: (t: TrackView) => void
  onPlayContext: (uri: string) => void
  onOpen: (p: Playlist) => void
}) {
  const empty = results.tracks.length + results.playlists.length + results.albums.length === 0
  return (
    <div className="space-y-6 pt-2">
      {empty && <p className="py-6 text-sm text-[#b3b3b3]">Nothing found.</p>}
      {results.tracks.length > 0 && (
        <div>
          <h3 className="mb-2 text-xl font-bold">Songs</h3>
          <ol>{results.tracks.map((t) => <Row key={t.uri} track={t} active={t.uri === active} onPlay={() => onPlayTrack(t)} onQueue={() => onQueue(t)} />)}</ol>
        </div>
      )}
      {results.playlists.length > 0 && (
        <Shelf title="Playlists">{results.playlists.map((p) => <Card key={p.id} image={p.image} title={p.name} subtitle={p.by ?? ''} onClick={() => onOpen(p)} onPlay={() => onPlayContext(p.uri)} playing={false} />)}</Shelf>
      )}
      {results.albums.length > 0 && (
        <Shelf title="Albums">{results.albums.map((a) => <Card key={a.id} image={a.image} title={a.name} subtitle={a.by ?? ''} onPlay={() => onPlayContext(a.uri)} playing={false} />)}</Shelf>
      )}
    </div>
  )
}

function ListView({ title, subtitle, art, tracks, active, busy, onBack, onPlayAll, onPlayTrack, onQueue }: {
  title: string
  subtitle: string
  art: React.ReactNode
  tracks: TrackView[] | null
  active?: string
  busy: boolean
  onBack: () => void
  onPlayAll: () => void
  onPlayTrack: (t: TrackView) => void
  onQueue: (t: TrackView) => void
}) {
  return (
    <div className="pt-2">
      <button type="button" onClick={onBack} className="mb-3 inline-flex cursor-pointer items-center gap-1 text-xs text-[#b3b3b3] hover:text-white">
        <ArrowLeft className="size-3.5" aria-hidden />
        Home
      </button>
      <div className="flex items-end gap-5">
        {art}
        <div className="min-w-0">
          <p className="text-xs text-[#b3b3b3]">Playlist</p>
          <h2 className="truncate text-3xl font-black tracking-tight">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-[#b3b3b3]">{subtitle}</p>}
        </div>
      </div>
      <div className="mt-4 mb-2">
        <button type="button" onClick={onPlayAll} disabled={busy || !tracks?.length} aria-label={`Play ${title}`} className="inline-flex size-12 cursor-pointer items-center justify-center rounded-full bg-[#1DB954] text-black hover:scale-105 disabled:opacity-50">
          <Play className="size-5 fill-current" aria-hidden />
        </button>
      </div>
      <ol className="max-h-[420px] overflow-y-auto pr-1">
        {tracks === null && <li className="py-2 text-xs text-[#b3b3b3]">Loading…</li>}
        {tracks?.length === 0 && <li className="py-2 text-xs text-[#b3b3b3]">No songs here.</li>}
        {tracks?.map((t, i) => <Row key={`${t.uri}:${i}`} index={i + 1} track={t} active={t.uri === active} onPlay={() => onPlayTrack(t)} onQueue={() => onQueue(t)} />)}
      </ol>
    </div>
  )
}

/* ---------- pieces ---------- */

function Shelf({ eyebrow, title, children }: { eyebrow?: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      {eyebrow && <p className="text-xs text-[#b3b3b3]">{eyebrow}</p>}
      <h3 className="mb-3 text-2xl font-bold tracking-tight">{title}</h3>
      <div className="flex gap-3 overflow-x-auto pb-2">{children}</div>
    </div>
  )
}

function Tile({ art, label, playing, onClick, onPlay }: { art: React.ReactNode; label: string; playing: boolean; onClick: () => void; onPlay?: () => void }) {
  return (
    <div className="group flex h-14 items-center overflow-hidden rounded bg-white/10 hover:bg-white/20">
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
        <span className="shrink-0 overflow-hidden">{art}</span>
        <span className={cn('truncate pr-2 text-sm font-bold', playing && 'text-[#1DB954]')}>{label}</span>
      </button>
      {onPlay && (
        <button type="button" onClick={onPlay} aria-label={`Play ${label}`} className="mr-2 hidden size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#1DB954] text-black shadow group-hover:flex">
          <Play className="size-4 fill-current" aria-hidden />
        </button>
      )}
    </div>
  )
}

function Card({ image, title, subtitle, round, playing, onClick, onPlay }: { image: string | null; title: string; subtitle: string; round?: boolean; playing: boolean; onClick?: () => void; onPlay: () => void }) {
  return (
    <div className="group relative w-40 shrink-0 rounded-md p-2.5 hover:bg-white/10">
      <button type="button" onClick={onClick ?? onPlay} className="block w-full cursor-pointer text-left">
        <Art src={image} className={cn('aspect-square w-full shadow-lg', round ? 'rounded-full' : 'rounded')} />
        <p className={cn('mt-2 truncate text-sm font-semibold', playing && 'text-[#1DB954]')} title={title}>{title}</p>
        <p className="truncate text-xs text-[#b3b3b3]">{subtitle}</p>
      </button>
      <button type="button" onClick={onPlay} aria-label={`Play ${title}`} className="absolute right-4 bottom-16 hidden size-11 cursor-pointer items-center justify-center rounded-full bg-[#1DB954] text-black shadow-lg group-hover:flex">
        <Play className="size-5 fill-current" aria-hidden />
      </button>
    </div>
  )
}

function Row({ track, index, active, onPlay, onQueue }: { track: TrackView; index?: number; active?: boolean; onPlay?: () => void; onQueue?: () => void }) {
  return (
    <li className="group flex items-center gap-3 rounded px-2 py-1.5 hover:bg-white/10">
      <button type="button" onClick={onPlay} disabled={!onPlay} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left disabled:cursor-default">
        {index != null ? (
          <span className={cn('tnum w-5 shrink-0 text-right text-sm', active ? 'text-[#1DB954]' : 'text-[#b3b3b3]')}>{index}</span>
        ) : (
          <Art src={track.image} className="size-10 rounded" />
        )}
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm', active ? 'text-[#1DB954]' : 'text-white')}>{track.name}</span>
          <span className="block truncate text-xs text-[#b3b3b3]">{track.artist}</span>
        </span>
      </button>
      {onQueue && (
        <button type="button" onClick={onQueue} className="hidden cursor-pointer text-[11px] text-[#b3b3b3] hover:text-white group-hover:inline">+ Queue</button>
      )}
      <span className="tnum w-10 shrink-0 text-right text-xs text-[#b3b3b3]">{clock(track.durationMs)}</span>
    </li>
  )
}

function Art({ src, className }: { src: string | null; className: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={cn('shrink-0 object-cover', className)} />
  ) : (
    <div className={cn('shrink-0 bg-[#2a2a2a]', className)} />
  )
}

function Ctl({ label, onClick, disabled, primary, on, children }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean; on?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} aria-pressed={on}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center rounded-full disabled:opacity-50',
        primary ? 'size-9 bg-white text-black hover:scale-105' : 'size-8 hover:text-white',
        !primary && (on ? 'text-[#1DB954]' : 'text-[#b3b3b3]'),
      )}
    >
      {children}
    </button>
  )
}

function SpotifyMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-7 shrink-0 text-white" aria-hidden>
      <path fill="currentColor" d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm5.5 17.3a.75.75 0 0 1-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 1 1-.33-1.46c4.57-1.05 8.5-.6 11.66 1.34.35.22.46.68.25 1.03Zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.23-1.99-8.15-2.56-11.97-1.4a.94.94 0 1 1-.55-1.8c4.36-1.32 9.78-.68 13.5 1.6.44.27.58.85.31 1.29Zm.13-3.4C15.23 8.33 8.85 8.12 5.15 9.24a1.13 1.13 0 1 1-.65-2.16c4.25-1.29 11.3-1.04 15.76 1.61a1.13 1.13 0 0 1-1.16 1.94Z" />
    </svg>
  )
}
