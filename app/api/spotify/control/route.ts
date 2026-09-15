import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { spotify, SpotifyError } from '@/lib/spotify/server'

const uri = z.string().startsWith('spotify:')
const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('play'),
    contextUri: uri.optional(),
    /** Start the context at this track. */
    offsetUri: uri.optional(),
    /** Play these tracks instead of a context. */
    uris: z.array(uri).max(50).optional(),
  }),
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('next') }),
  z.object({ action: z.literal('previous') }),
  z.object({ action: z.literal('seek'), positionMs: z.number().int().min(0) }),
  z.object({ action: z.literal('shuffle'), state: z.boolean() }),
  z.object({ action: z.literal('repeat'), state: z.enum(['off', 'context', 'track']) }),
  z.object({ action: z.literal('volume'), percent: z.number().int().min(0).max(100) }),
  z.object({ action: z.literal('transfer'), deviceId: z.string().min(1) }),
  z.object({ action: z.literal('queue'), uri }),
])

const json = { 'Content-Type': 'application/json' }

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  const cmd = parsed.data
  const id = user.id

  try {
    switch (cmd.action) {
      case 'play': {
        const body = cmd.uris
          ? { uris: cmd.uris }
          : cmd.contextUri
            ? { context_uri: cmd.contextUri, ...(cmd.offsetUri ? { offset: { uri: cmd.offsetUri } } : {}) }
            : undefined
        await spotify(id, '/me/player/play', { method: 'PUT', headers: json, body: body && JSON.stringify(body) })
        break
      }
      case 'pause':
        await spotify(id, '/me/player/pause', { method: 'PUT' })
        break
      case 'next':
        await spotify(id, '/me/player/next', { method: 'POST' })
        break
      case 'previous':
        await spotify(id, '/me/player/previous', { method: 'POST' })
        break
      case 'seek':
        await spotify(id, `/me/player/seek?position_ms=${cmd.positionMs}`, { method: 'PUT' })
        break
      case 'shuffle':
        await spotify(id, `/me/player/shuffle?state=${cmd.state}`, { method: 'PUT' })
        break
      case 'repeat':
        await spotify(id, `/me/player/repeat?state=${cmd.state}`, { method: 'PUT' })
        break
      case 'volume':
        await spotify(id, `/me/player/volume?volume_percent=${cmd.percent}`, { method: 'PUT' })
        break
      case 'transfer':
        await spotify(id, '/me/player', {
          method: 'PUT',
          headers: json,
          body: JSON.stringify({ device_ids: [cmd.deviceId], play: true }),
        })
        break
      case 'queue':
        await spotify(id, `/me/player/queue?uri=${encodeURIComponent(cmd.uri)}`, { method: 'POST' })
        break
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const status = e instanceof SpotifyError ? e.status : 500
    return NextResponse.json({ error: (e as Error).message }, { status: status === 401 ? 401 : 502 })
  }
}
