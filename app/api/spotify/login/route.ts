import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { env } from '@/lib/env'
import { pkcePair, redirectUri, SPOTIFY_SCOPES } from '@/lib/spotify/server'

/** Start the Spotify sign-in. The PKCE verifier rides in a short-lived cookie. */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))

  const { verifier, challenge } = pkcePair()
  const origin = new URL(request.url).origin
  const params = new URLSearchParams({
    client_id: env.spotifyClientId,
    response_type: 'code',
    redirect_uri: redirectUri(origin),
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state: user.id,
  })

  const res = NextResponse.redirect(`https://accounts.spotify.com/authorize?${params}`)
  res.cookies.set('spotify_pkce', verifier, {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https'),
    path: '/api/spotify',
    maxAge: 600,
  })
  return res
}
