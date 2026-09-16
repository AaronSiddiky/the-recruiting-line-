import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hangUpSession } from '@/lib/twilio/calls'
import { DEFAULT_LINES_PER_BATCH } from '@/lib/constants'

/** A session polled more recently than this is someone actively dialing. */
const ALIVE_WINDOW_MS = 45_000

/**
 * Open a dialing session. One active session per agent: a stale session from a
 * closed tab still owns a conference and would keep answering webhooks, so we
 * tear down anything the agent left running before opening a new one.
 *
 * A session that is still being polled is not stale: it is this account
 * dialing in another window, or another person on this login. Cutting it off
 * silently hangs up their calls, so that needs an explicit `force`.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { force } = ((await request.json().catch(() => ({}))) ?? {}) as { force?: boolean }
  const admin = createAdminClient()

  const { data: stale } = await admin
    .from('call_sessions')
    .select('id, last_seen_at')
    .eq('agent_id', user.id)
    .eq('status', 'active')

  const alive = (stale ?? []).find(
    (s) => Date.now() - new Date(s.last_seen_at ?? 0).getTime() < ALIVE_WINDOW_MS,
  )
  if (alive && !force) {
    const seconds = Math.round((Date.now() - new Date(alive.last_seen_at).getTime()) / 1000)
    return NextResponse.json(
      {
        error: 'This account is already dialing in another window.',
        activeElsewhere: true,
        lastSeenSeconds: seconds,
      },
      { status: 409 },
    )
  }

  for (const session of stale ?? []) {
    await hangUpSession(session.id)
    await admin
      .from('call_sessions')
      .update({ status: 'ended', ended_at: new Date().toISOString() })
      .eq('id', session.id)
  }

  const { data: session, error } = await admin
    .from('call_sessions')
    .insert({
      agent_id: user.id,
      conference_name: `rl-${randomUUID()}`,
      lines_per_batch: DEFAULT_LINES_PER_BATCH,
    })
    .select('id, conference_name, lines_per_batch')
    .single()

  if (error || !session) {
    return NextResponse.json({ error: error?.message ?? 'Could not start.' }, { status: 500 })
  }

  return NextResponse.json({
    sessionId: session.id,
    conferenceName: session.conference_name,
    linesPerBatch: session.lines_per_batch,
  })
}
