import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'

export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-private',
].join(' ')

const ACCOUNTS = 'https://accounts.spotify.com'
const API = 'https://api.spotify.com/v1'

export class SpotifyError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

/** PKCE: Spotify accepts the code_challenge instead of a client secret. */
export function pkcePair() {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function redirectUri(origin: string) {
  return `${origin}/api/spotify/callback`
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.spotifyClientId, ...body }),
  })
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { error_description?: string }
  if (!res.ok) throw new SpotifyError(data.error_description ?? 'Spotify sign-in failed.', res.status)
  return data
}

export async function exchangeCode(userId: string, code: string, verifier: string, redirect: string) {
  const t = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirect,
    code_verifier: verifier,
  })
  if (!t.refresh_token) throw new SpotifyError('Spotify did not return a refresh token.', 500)

  const me = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${t.access_token}` } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)

  const { error } = await createAdminClient()
    .from('spotify_tokens')
    .upsert({
      user_id: userId,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      scope: t.scope ?? null,
      display_name: me?.display_name ?? null,
      updated_at: new Date().toISOString(),
    })
  if (error) throw new SpotifyError(`Could not save the Spotify sign-in (spotify_tokens): ${error.message}`, 500)
}

/** A valid access token for this rep, refreshing if it expires within a minute. */
async function accessToken(userId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data: row } = await admin.from('spotify_tokens').select('*').eq('user_id', userId).maybeSingle()
  if (!row) return null

  if (new Date(row.expires_at).getTime() - Date.now() > 60_000) return row.access_token

  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: row.refresh_token })
  await admin
    .from('spotify_tokens')
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? row.refresh_token,
      expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
  return t.access_token
}

export async function isConnected(userId: string) {
  const { data } = await createAdminClient()
    .from('spotify_tokens')
    .select('display_name')
    .eq('user_id', userId)
    .maybeSingle()
  return data ? { displayName: data.display_name } : null
}

export async function disconnect(userId: string) {
  await createAdminClient().from('spotify_tokens').delete().eq('user_id', userId)
}

/**
 * Call the Web API as this rep. Returns null on 204 (nothing playing).
 * Spotify's playback endpoints answer 403 on free accounts and 404 when no
 * device is active; both come back as SpotifyError with a readable message.
 */
export async function spotify<T = unknown>(
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const token = await accessToken(userId)
  if (!token) throw new SpotifyError('Spotify is not connected.', 401)

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  })
  if (res.status === 204) return null
  if (res.ok) {
    const text = await res.text()
    return text ? (JSON.parse(text) as T) : null
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; reason?: string } }
  const reason = body.error?.reason
  const message =
    reason === 'PREMIUM_REQUIRED'
      ? 'Playback control needs Spotify Premium.'
      : reason === 'NO_ACTIVE_DEVICE' || res.status === 404
        ? 'Open Spotify on your phone or computer and press play once, then control it from here.'
        : (body.error?.message ?? `Spotify error ${res.status}`)
  throw new SpotifyError(message, res.status)
}
