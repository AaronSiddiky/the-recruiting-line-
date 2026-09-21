import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { twilioClient, webhookUrl } from '@/lib/twilio/client'
import { withinCallingHours } from '@/lib/utils'
import { availableLines } from '@/lib/twilio/budget'
import { callerIdFor } from '@/lib/twilio/caller-ids'
import { accountForAgent } from '@/lib/twilio/accounts'
import { DIAL_TIMEOUT_SECONDS } from '@/lib/constants'

export type DialLine = {
  callId: string
  companyId: string
  companyName: string
  phone: string
  kind?: 'company' | 'tech'
  techId?: string
}

/**
 * Dial the next lead in the queue. One call, from the rep's own number.
 *
 * Lead selection and reservation happen inside `start_dial_batch` in one
 * transaction, so two reps hitting this at the same moment can never be handed
 * the same company. The Twilio call is created only after the row exists -- if
 * the process dies mid-dial, the reserved row is still there to reconcile
 * rather than being silently lost.
 *
 * The RPC still takes a limit because it used to fan out several lines at
 * once. That is over: ringing four prospects to talk to one meant three people
 * picked up a call that hung up on them, and under Twilio's concurrent-call
 * cap it mostly meant queueing behind the other rep. It asks for one.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { sessionId } = (await request.json()) as { sessionId?: string }
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: session, error: sessionError } = await admin
    .from('call_sessions')
    .select('id, agent_id, status, conference_name, live_call_id, queue')
    .eq('id', sessionId)
    .maybeSingle()

  if (sessionError && /live_call_id/.test(sessionError.message)) {
    return NextResponse.json(
      { error: 'Database is behind the app: run supabase/migrations/0018_continuous_dialing.sql in the Supabase SQL editor.' },
      { status: 500 },
    )
  }

  if (!session || session.agent_id !== user.id) {
    return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
  }
  if (session.status !== 'active') {
    return NextResponse.json({ error: 'Session already ended.' }, { status: 409 })
  }

  // Never dial while the rep is already on a call.
  if (session.live_call_id) {
    const { data: live } = await admin.from('calls').select('ended_at').eq('id', session.live_call_id).maybeSingle()
    if (live && !live.ended_at) {
      return NextResponse.json({ error: 'A call is in progress.', busy: true }, { status: 409 })
    }
  }

  // One prospect leg, and the rep's own softphone leg already holds a slot of
  // its own. Each rep dials through their own Twilio account, against its cap.
  const account = await accountForAgent(user.id)
  const budget = await availableLines(account, user.id)
  if (budget.available < 1) {
    return NextResponse.json({ lines: [], capped: true, cap: budget.cap, agents: budget.agents, inFlight: budget.inFlight })
  }

  const techQueue = session.queue === 'techs'
  type Reserved = { call_id: string; batch_id: string; company_id: string; company_name: string; phone: string; tech_id?: string }
  let reserved: Reserved[] | null = null
  let error: { message: string } | null = null
  if (techQueue) {
    const r = await admin.rpc('start_tech_batch', { p_session: sessionId, p_agent: user.id, p_limit: 1 })
    error = r.error
    reserved = (r.data ?? []).map((t) => ({ call_id: t.call_id, batch_id: t.batch_id, company_id: '', company_name: t.tech_name, phone: t.phone, tech_id: t.tech_id }))
  } else {
    const r = await admin.rpc('start_dial_batch', { p_session: sessionId, p_agent: user.id, p_limit: 1 })
    error = r.error
    reserved = r.data
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!reserved?.length) {
    return NextResponse.json({ lines: [], exhausted: true })
  }

  const lead = reserved[0]
  const batchId = lead.batch_id

  // Calling-hours check happens here rather than in SQL: it needs a timezone
  // database, and Postgres would have to be told the local hour for the row.
  // Techs are people in Arizona; the company lookup has no entry for them,
  // which withinCallingHours treats as "unknown, go ahead".
  let timezone: string | null = null
  if (!techQueue) {
    const { data: company } = await admin
      .from('companies')
      .select('timezone')
      .eq('id', lead.company_id)
      .maybeSingle()
    timezone = company?.timezone ?? null
  }

  if (!withinCallingHours(timezone, new Date())) {
    // The row must not linger as `dialing`, or the in-flight guard will lock
    // this company out of the queue for two minutes.
    await admin
      .from('calls')
      .update({
        status: 'canceled',
        ended_at: new Date().toISOString(),
        notes: 'Outside calling hours for this prospect.',
      })
      .eq('id', lead.call_id)
    return NextResponse.json({ batchId, lines: [], skippedForHours: 1, exhausted: false, skipped: true })
  }

  try {
    const call = await twilioClient(account).calls.create({
      to: lead.phone,
      // This rep's own number. Always the same one, so a prospect who has been
      // called before recognises it and a callback reaches the right person.
      from: await callerIdFor(user.id),
      timeout: DIAL_TIMEOUT_SECONDS,
      url: webhookUrl('/api/twilio/answer', {
        callId: lead.call_id,
        batchId,
        conference: session.conference_name,
      }),
      statusCallback: webhookUrl('/api/twilio/status', { callId: lead.call_id }),
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      // No answering-machine detection: it misjudged real people, so the rep
      // hangs up on any voicemail greeting and dispositions it like any call.
    })

    // QueueTime is how long Twilio expects to hold this call before dialing
    // (its account-wide calls-per-second limit). Kept on the row so a leg
    // that never rings can be explained after the fact.
    const queued = Number(call.queueTime ?? 0)
    await admin
      .from('calls')
      .update({ call_sid: call.sid, notes: queued > 0 ? `Twilio queue time: ${Math.round(queued / 1000)}s` : null })
      .eq('id', lead.call_id)
  } catch (twilioError) {
    await admin
      .from('calls')
      .update({
        status: 'failed',
        ended_at: new Date().toISOString(),
        notes: twilioError instanceof Error ? `Dial failed: ${twilioError.message}` : 'Dial failed.',
      })
      .eq('id', lead.call_id)
    const message = twilioError instanceof Error ? twilioError.message : 'Dial failed.'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const line: DialLine = {
    callId: lead.call_id,
    companyId: lead.company_id,
    companyName: lead.company_name,
    phone: lead.phone,
    kind: lead.tech_id ? 'tech' : 'company',
    techId: lead.tech_id,
  }

  return NextResponse.json({ batchId, lines: [line], skippedForHours: 0, exhausted: false, cap: budget.cap })
}
