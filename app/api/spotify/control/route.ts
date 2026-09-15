import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { spotify, SpotifyError } from '@/lib/spotify/server'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('play'), contextUri: z.string().startsWith('spotify:').optional() }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('next') }),
  z.object({ action: z.literal('previous') }),
  z.object({ action: z.literal('volume'), percent: z.number().int().min(0).max(100) }),
  z.object({ action: z.literal('transfer'), deviceId: z.string().min(1) }),
])

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  const cmd = parsed.data

  try {
    switch (cmd.action) {
      case 'play':
        await spotify(user.id, '/me/player/play', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: cmd.contextUri ? JSON.stringify({ context_uri: cmd.contextUri }) : undefined,
        })
        break
      case 'pause':
        await spotify(user.id, '/me/player/pause', { method: 'PUT' })
        break
      case 'next':
        await spotify(user.id, '/me/player/next', { method: 'POST' })
        break
      case 'previous':
        await spotify(user.id, '/me/player/previous', { method: 'POST' })
        break
      case 'volume':
        await spotify(user.id, `/me/player/volume?volume_percent=${cmd.percent}`, { method: 'PUT' })
        break
      case 'transfer':
        await spotify(user.id, '/me/player', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_ids: [cmd.deviceId], play: true }),
        })
        break
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const status = e instanceof SpotifyError ? e.status : 500
    return NextResponse.json({ error: (e as Error).message }, { status: status === 401 ? 401 : 502 })
  }
}
