import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { spotify, SpotifyError } from '@/lib/spotify/server'
import { trackView, type SpotifyItem } from '@/lib/spotify/views'

// Spotify renamed /tracks to /items in 2025; entries carry the song as `item`
// (older responses used `track`, kept as a fallback).
type Page = { items: { item?: SpotifyItem | null; track?: SpotifyItem | null }[]; next: string | null }

export async function GET(_request: NextRequest, ctx: RouteContext<'/api/spotify/playlists/[id]/tracks'>) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!/^[A-Za-z0-9]+$/.test(id)) return NextResponse.json({ error: 'Bad playlist.' }, { status: 400 })

  try {
    const page = await spotify<Page>(
      user.id,
      `/playlists/${id}/items?limit=100&fields=items(item(id,name,uri,duration_ms,artists(name),album(name,images))),next`,
    )
    return NextResponse.json({
      tracks: (page?.items ?? []).map((i) => trackView(i.item ?? i.track)).filter(Boolean),
      more: !!page?.next,
    })
  } catch (e) {
    const status = e instanceof SpotifyError ? e.status : 500
    return NextResponse.json({ error: (e as Error).message }, { status: status === 401 ? 401 : 502 })
  }
}
