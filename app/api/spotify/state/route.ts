import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isConnected, spotify, SpotifyError } from '@/lib/spotify/server'

type Player = {
  is_playing: boolean
  progress_ms: number | null
  shuffle_state?: boolean
  device?: { id: string; name: string; type: string; volume_percent: number | null }
  context?: { uri: string; type: string } | null
  item?: {
    id: string
    name: string
    duration_ms: number
    uri: string
    artists?: { name: string }[]
    album?: { name: string; images?: { url: string; width: number }[] }
    show?: { name: string; images?: { url: string; width: number }[] }
  } | null
}

type Devices = { devices: { id: string; name: string; type: string; is_active: boolean }[] }

/** Everything the dock needs in one round trip. Polled every few seconds. */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  if (!process.env.SPOTIFY_CLIENT_ID) return NextResponse.json({ connected: false, configured: false })

  const connection = await isConnected(user.id)
  if (!connection) return NextResponse.json({ connected: false, configured: true })

  try {
    const [player, devices] = await Promise.all([
      spotify<Player>(user.id, '/me/player?additional_types=track,episode'),
      spotify<Devices>(user.id, '/me/player/devices'),
    ])
    const item = player?.item ?? null
    const images = item?.album?.images ?? item?.show?.images ?? []
    return NextResponse.json({
      connected: true,
      displayName: connection.displayName,
      isPlaying: player?.is_playing ?? false,
      progressMs: player?.progress_ms ?? 0,
      durationMs: item?.duration_ms ?? 0,
      track: item
        ? {
            name: item.name,
            artist: item.artists?.map((a) => a.name).join(', ') ?? item.show?.name ?? '',
            image: images.slice().sort((a, b) => a.width - b.width)[0]?.url ?? null,
          }
        : null,
      device: player?.device ?? null,
      devices: devices?.devices ?? [],
    })
  } catch (e) {
    const status = e instanceof SpotifyError ? e.status : 500
    if (status === 401) return NextResponse.json({ connected: false, expired: true })
    return NextResponse.json({ connected: true, displayName: connection.displayName, error: (e as Error).message })
  }
}
