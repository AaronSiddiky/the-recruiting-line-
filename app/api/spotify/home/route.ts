import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { spotify, SpotifyError } from '@/lib/spotify/server'
import { trackView, type SpotifyItem } from '@/lib/spotify/views'

type Img = { url: string; width: number | null }
type PlaylistRaw = { id: string; name: string; uri: string; images?: Img[]; items?: { total: number }; tracks?: { total: number }; owner?: { id?: string; display_name?: string } }
type Page<T> = { items: T[]; total?: number }
type Artist = { id: string; name: string; uri: string; images?: Img[] }

const smallest = (images?: Img[]) => images?.slice().sort((a, b) => (a.width ?? 999) - (b.width ?? 999))[0]?.url ?? null
const largest = (images?: Img[]) => images?.slice().sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null
const playlist = (p: PlaylistRaw) => ({
  id: p.id,
  name: p.name,
  uri: p.uri,
  image: largest(p.images),
  tracks: p.items?.total ?? p.tracks?.total ?? null,
  by: p.owner?.display_name ?? null,
  bySpotify: p.owner?.id === 'spotify',
})

/**
 * One call that fills the home view: shortcut tiles, Spotify-made playlists
 * the rep has saved, top artists and songs, recently played, and liked songs.
 * Each block fails independently so one missing permission does not blank
 * the whole screen.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const id = user.id
  const safe = <T,>(p: Promise<T | null>) => p.catch((e) => (e instanceof SpotifyError && e.status === 401 ? Promise.reject(e) : null))

  try {
    const [lists, liked, artists, topTracks, recent] = await Promise.all([
      safe(spotify<Page<PlaylistRaw>>(id, '/me/playlists?limit=50')),
      safe(spotify<Page<{ track: SpotifyItem }>>(id, '/me/tracks?limit=50')),
      safe(spotify<Page<Artist>>(id, '/me/top/artists?limit=12&time_range=short_term')),
      safe(spotify<Page<SpotifyItem>>(id, '/me/top/tracks?limit=12&time_range=short_term')),
      safe(spotify<Page<{ track: SpotifyItem; context?: { uri: string } | null }>>(id, '/me/player/recently-played?limit=40')),
    ])

    const playlists = (lists?.items ?? []).filter(Boolean).map(playlist)
    const seen = new Set<string>()
    const recentTracks = (recent?.items ?? [])
      .map((i) => trackView(i.track))
      .filter((t): t is NonNullable<typeof t> => !!t && !seen.has(t.uri) && !!seen.add(t.uri))
      .slice(0, 12)

    return NextResponse.json({
      playlists,
      madeForYou: playlists.filter((p) => p.bySpotify),
      topArtists: (artists?.items ?? []).map((a) => ({ id: a.id, name: a.name, uri: a.uri, image: smallest(a.images) })),
      topTracks: (topTracks?.items ?? []).map(trackView).filter(Boolean),
      recent: recentTracks,
      liked: { total: liked?.total ?? 0, tracks: (liked?.items ?? []).map((i) => trackView(i.track)).filter(Boolean) },
    })
  } catch (e) {
    const status = e instanceof SpotifyError ? e.status : 500
    return NextResponse.json({ error: (e as Error).message }, { status: status === 401 ? 401 : 502 })
  }
}
