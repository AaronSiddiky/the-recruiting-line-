import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { spotify, SpotifyError } from '@/lib/spotify/server'
import { trackView, type SpotifyItem } from '@/lib/spotify/views'

type Result = {
  tracks?: { items: SpotifyItem[] }
  playlists?: { items: ({ id: string; name: string; uri: string; images?: { url: string; width: number | null }[]; owner?: { display_name?: string } } | null)[] }
  albums?: { items: { id: string; name: string; uri: string; images?: { url: string; width: number | null }[]; artists?: { name: string }[] }[] }
  shows?: { items: ({ id: string; name: string; uri: string; images?: { url: string; width: number | null }[]; publisher?: string } | null)[] }
  episodes?: { items: (SpotifyItem | null)[] }
}

const smallest = (images?: { url: string; width: number | null }[]) =>
  images?.slice().sort((a, b) => (a.width ?? 999) - (b.width ?? 999))[0]?.url ?? null

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const q = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 120)
  if (!q) return NextResponse.json({ tracks: [], playlists: [], albums: [], shows: [], episodes: [] })

  try {
    const r = await spotify<Result>(user.id, `/search?type=track,playlist,album,show,episode&limit=10&q=${encodeURIComponent(q)}`)
    return NextResponse.json({
      tracks: (r?.tracks?.items ?? []).map((i) => trackView(i)).filter(Boolean),
      playlists: (r?.playlists?.items ?? []).filter(Boolean).map((p) => ({
        id: p!.id,
        name: p!.name,
        uri: p!.uri,
        image: smallest(p!.images),
        by: p!.owner?.display_name ?? null,
      })),
      albums: (r?.albums?.items ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        uri: a.uri,
        image: smallest(a.images),
        by: a.artists?.map((x) => x.name).join(', ') ?? null,
      })),
      shows: (r?.shows?.items ?? []).filter(Boolean).map((sh) => ({
        id: sh!.id,
        name: sh!.name,
        uri: sh!.uri,
        image: smallest(sh!.images),
        by: sh!.publisher ?? null,
      })),
      episodes: (r?.episodes?.items ?? []).map((e) => trackView(e, 'Podcast episode')).filter(Boolean),
    })
  } catch (e) {
    const status = e instanceof SpotifyError ? e.status : 500
    return NextResponse.json({ error: (e as Error).message }, { status: status === 401 ? 401 : 502 })
  }
}
