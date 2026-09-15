import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { spotify, SpotifyError } from '@/lib/spotify/server'

type Page = {
  items: { id: string; name: string; uri: string; images?: { url: string; width: number | null }[]; tracks?: { total: number } }[]
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  try {
    const page = await spotify<Page>(user.id, '/me/playlists?limit=50')
    return NextResponse.json({
      playlists: (page?.items ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        uri: p.uri,
        image: p.images?.slice().sort((a, b) => (a.width ?? 999) - (b.width ?? 999))[0]?.url ?? null,
        tracks: p.tracks?.total ?? null,
      })),
    })
  } catch (e) {
    const status = e instanceof SpotifyError ? e.status : 500
    return NextResponse.json({ error: (e as Error).message }, { status: status === 401 ? 401 : 502 })
  }
}
