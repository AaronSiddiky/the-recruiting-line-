import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * A leg still "dialing" or "ringing" this long after it was created never got
 * a status callback (the dial timeout is 25 s). Close it out as no answer so
 * it stops looking live and stops counting as a call in flight.
 */
const STALE_LEG_MS = 3 * 60_000

/**
 * Every call row in one dialing session: the dialer's polling fallback.
 *
 * Realtime is the fast path for call state, but it can stop without an error,
 * and a dialer that quietly freezes mid-call is the failure agents trust least.
 * The browser polls this to reconcile. It reads under the agent's own session,
 * so RLS scopes it exactly as it scopes everything else.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/session/[id]/calls'>) {
  const { id } = await ctx.params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { data: session } = await supabase
    .from('call_sessions')
    .select('id, agent_id, status')
    .eq('id', id)
    .maybeSingle()

  if (!session || session.agent_id !== user.id) {
    return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
  }

  const nowIso = new Date().toISOString()
  // Heartbeat: this poll proves the dialer is open, which is what stops a
  // second window from cutting the session off.
  if (session.status === 'active') {
    void supabase.from('call_sessions').update({ last_seen_at: nowIso }).eq('id', id).then(() => undefined)
  }
  await supabase
    .from('calls')
    .update({ status: 'no_answer', ended_at: nowIso, notes: 'No status from Twilio; closed as no answer after 3 minutes.' })
    .eq('session_id', id)
    .in('status', ['dialing', 'ringing'])
    .lt('started_at', new Date(Date.now() - STALE_LEG_MS).toISOString())

  const { data: calls, error } = await supabase
    .from('calls')
    .select(
      'id, company_id, status, amd_result, outcome, started_at, answered_at, ended_at, duration_seconds, notes, updated_at',
    )
    .eq('session_id', id)
    .order('started_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    { sessionStatus: session.status, calls: calls ?? [] },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
