import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { spotify, SpotifyError } from '@/lib/spotify/server'
import { trackView, type SpotifyItem } from '@/lib/spotify/views'

type Show = { id: string; name: string; uri: string; publisher?: string; images?: { url: string; width: number | null }[]; total_episodes?: number }
type Page = { items: (SpotifyItem | null)[]; next: string | null }

export async function GET(_request: NextRequest, ctx: RouteContext<'/api/spotify/shows/[id]/episodes'>) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!/^[A-Za-z0-9]+$/.test(id)) return NextResponse.json({ error: 'Bad show.' }, { status: 400 })

  try {
    const [show, page] = await Promise.all([
      spotify<Show>(user.id, `/shows/${id}?market=from_token`),
      spotify<Page>(user.id, `/shows/${id}/episodes?limit=50&market=from_token`),
    ])
    return NextResponse.json({
      show: show && {
        id: show.id,
        name: show.name,
        uri: show.uri,
        by: show.publisher ?? null,
        image: show.images?.slice().sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null,
        total: show.total_episodes ?? null,
      },
      episodes: (page?.items ?? []).map((e) => trackView(e, show?.name ?? 'Podcast')).filter(Boolean),
      more: !!page?.next,
    })
  } catch (e) {
    const status = e instanceof SpotifyError ? e.status : 500
    return NextResponse.json({ error: (e as Error).message }, { status: status === 401 ? 401 : 502 })
  }
}
