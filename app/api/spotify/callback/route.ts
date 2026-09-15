import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCode, redirectUri, SpotifyError } from '@/lib/spotify/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const back = (q: string) => NextResponse.redirect(new URL(`/dialer?spotify=${q}`, url.origin))

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', url.origin))

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const verifier = request.cookies.get('spotify_pkce')?.value
  if (url.searchParams.get('error') || !code || state !== user.id || !verifier) {
    return back('denied')
  }

  try {
    await exchangeCode(user.id, code, verifier, redirectUri(url.origin))
  } catch (e) {
    console.error('Spotify callback failed', e instanceof SpotifyError ? e.message : e)
    return back('failed')
  }

  const res = back('connected')
  res.cookies.delete('spotify_pkce')
  return res
}
