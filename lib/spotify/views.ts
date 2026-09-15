/** Shapes Spotify's track/episode objects into what the deck renders. Safe for the client. */
export type SpotifyItem = {
  id: string
  name: string
  duration_ms: number
  uri: string
  artists?: { name: string }[]
  album?: { name: string; images?: { url: string; width: number | null }[] }
  show?: { name: string; publisher?: string; images?: { url: string; width: number | null }[] }
  /** Episodes fetched from a show carry their own artwork and no `show` block. */
  images?: { url: string; width: number | null }[]
  type?: string
}

export type TrackView = {
  uri: string
  name: string
  artist: string
  album: string
  image: string | null
  imageLarge: string | null
  durationMs: number
}

export function trackView(item: SpotifyItem | null | undefined, fallbackArtist = ''): TrackView | null {
  if (!item) return null
  const images = item.album?.images ?? item.show?.images ?? item.images ?? []
  const sorted = images.slice().sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return {
    uri: item.uri,
    name: item.name,
    artist: item.artists?.map((a) => a.name).join(', ') ?? item.show?.name ?? fallbackArtist,
    album: item.album?.name ?? item.show?.name ?? fallbackArtist,
    image: sorted[0]?.url ?? null,
    imageLarge: sorted[sorted.length - 1]?.url ?? null,
    durationMs: item.duration_ms,
  }
}
