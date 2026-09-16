import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { twilioClient } from '@/lib/twilio/client'

/**
 * A leg still "dialing" 8 s after creation gets its status checked at Twilio.
 * Twilio rejects calls over the account's concurrent-call cap (error 10004)
 * asynchronously and sends no webhook for them, so without this check the
 * line sits dead. A rejected or still-queued-too-long leg is cancelled at
 * Twilio as well as here and marked `canceled` (not a real dial), so the
 * company stays eligible and nothing is counted.
 */
const CHECK_AFTER_MS = 8_000
const NEVER_RANG_MS = 45_000
/** A leg that did ring but never reached a final state (dial timeout is 25 s). */
const STALE_RING_MS = 3 * 60_000

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
  const admin = createAdminClient()
  const { data: pending } = await admin
    .from('calls')
    .select('id, call_sid, notes, started_at')
    .eq('session_id', id)
    .eq('status', 'dialing')
    .lt('started_at', new Date(Date.now() - CHECK_AFTER_MS).toISOString())
  let rejected = 0
  for (const c of pending ?? []) {
    const age = Date.now() - new Date(c.started_at).getTime()
    let reason: string | null = null
    if (c.call_sid) {
      const twilioStatus = await twilioClient()
        .calls(c.call_sid)
        .fetch()
        .then((call) => call.status)
        .catch(() => null)
      if (twilioStatus === 'failed') {
        reason = 'Twilio rejected this call: account concurrent-call limit reached (error 10004).'
        rejected++
      } else if (twilioStatus === 'busy' || twilioStatus === 'no-answer' || twilioStatus === 'canceled') {
        reason = `Twilio reported ${twilioStatus}; the callback never arrived.`
      } else if (age > NEVER_RANG_MS) {
        reason = 'Twilio never started dialing within 45s; cancelled so the company can be tried again.'
        await twilioClient().calls(c.call_sid).update({ status: 'completed' }).catch(() => undefined)
      }
    } else if (age > NEVER_RANG_MS) {
      reason = 'Call was never created at Twilio.'
    }
    if (!reason) continue
    await admin
      .from('calls')
      .update({ status: 'canceled', ended_at: nowIso, notes: [c.notes, reason].filter(Boolean).join(' · ') })
      .eq('id', c.id)
  }
  await admin
    .from('calls')
    .update({ status: 'no_answer', ended_at: nowIso, notes: 'No final status from Twilio; closed as no answer after 3 minutes.' })
    .eq('session_id', id)
    .eq('status', 'ringing')
    .lt('started_at', new Date(Date.now() - STALE_RING_MS).toISOString())

  const { data: calls, error } = await supabase
    .from('calls')
    .select(
      'id, company_id, status, amd_result, outcome, started_at, answered_at, ended_at, duration_seconds, notes, updated_at',
    )
    .eq('session_id', id)
    .order('started_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    { sessionStatus: session.status, calls: calls ?? [], rejectedByTwilio: rejected },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
