import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCode, redirectUri } from '@/lib/spotify/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const back = (q: string, reason?: string) =>
    NextResponse.redirect(
      new URL(`/dialer?spotify=${q}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`, url.origin),
    )

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', url.origin))

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const verifier = request.cookies.get('spotify_pkce')?.value
  const spotifyError = url.searchParams.get('error')
  if (spotifyError) return back('denied', spotifyError)
  if (!code || state !== user.id || !verifier) {
    return back('denied', 'The sign-in did not come back with a valid code. Try again.')
  }

  try {
    await exchangeCode(user.id, code, verifier, redirectUri(url.origin))
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    console.error('Spotify callback failed', message)
    return back(
      'failed',
      /spotify_tokens/.test(message)
        ? 'The database is missing the Spotify table. Run supabase/migrations/0015_spotify.sql.'
        : message,
    )
  }

  const res = back('connected')
  res.cookies.delete('spotify_pkce')
  return res
}
