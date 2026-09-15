import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { spotify, SpotifyError } from '@/lib/spotify/server'
import { trackView, type SpotifyItem } from '@/lib/spotify/views'

type Queue = { queue: SpotifyItem[] }

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  try {
    const q = await spotify<Queue>(user.id, '/me/player/queue')
    return NextResponse.json({ queue: (q?.queue ?? []).slice(0, 10).map((i) => trackView(i)).filter(Boolean) })
  } catch (e) {
    const status = e instanceof SpotifyError ? e.status : 500
    return NextResponse.json({ error: (e as Error).message }, { status: status === 401 ? 401 : 502 })
  }
}
