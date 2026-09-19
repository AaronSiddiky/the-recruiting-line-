import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { twilioClient, webhookUrl } from '@/lib/twilio/client'
import { toE164, formatPhone } from '@/lib/utils'
import { DIAL_TIMEOUT_SECONDS } from '@/lib/constants'
import { availableLines } from '@/lib/twilio/budget'
import { callerIdsFor } from '@/lib/twilio/caller-ids'
import { accountForAgent } from '@/lib/twilio/accounts'

/**
 * Dial one number the agent typed by hand.
 *
 * Deliberately routed through the same conference, recording and exit-interview
 * path as a queued call. A manually dialed prospect is still a prospect: they
 * should end up on a company page with a recording and a disposition, not in a
 * side channel that leaves no trace in the CRM.
 *
 * The number may not correspond to a known company, so one is created on the
 * spot keyed by phone. `companies.phone` is unique, so dialing the same number
 * twice attaches both calls to the same record rather than forking history.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { sessionId, phone } = (await request.json()) as {
    sessionId?: string
    phone?: string
  }

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })
  }

  const e164 = toE164(phone)
  if (!e164) {
    return NextResponse.json(
      { error: `"${phone ?? ''}" is not a dialable number.` },
      { status: 400 },
    )
  }

  const admin = createAdminClient()

  const { data: session } = await admin
    .from('call_sessions')
    .select('id, agent_id, status, conference_name')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session || session.agent_id !== user.id) {
    return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
  }
  if (session.status !== 'active') {
    return NextResponse.json({ error: 'Session already ended.' }, { status: 409 })
  }

  // A number already in Techs is a call to that person, not to a shop.
  const { data: tech } = await admin
    .from('techs')
    .select('id, name, title, city, status')
    .eq('phone', e164)
    .maybeSingle()

  if (tech) {
    const t = tech as { id: string; name: string | null; title: string | null; city: string | null }
    const account = await accountForAgent(user.id)
    const budget = await availableLines(account)
    if (budget.available < 1) {
      return NextResponse.json(
        { error: `Twilio's call limit (${budget.cap} at once, softphones included) is full right now. Try again in a moment.` },
        { status: 429 },
      )
    }
    const { data: callRow, error: callError } = await admin
      .from('calls')
      .insert({ tech_id: t.id, agent_id: user.id, session_id: sessionId, status: 'dialing' })
      .select('id')
      .single()
    if (callError || !callRow) {
      return NextResponse.json({ error: callError?.message ?? 'Could not create the call record.' }, { status: 500 })
    }
    try {
      const call = await twilioClient(account).calls.create({
        to: e164,
        from: (await callerIdsFor(user.id))[0],
        timeout: DIAL_TIMEOUT_SECONDS,
        url: webhookUrl('/api/twilio/answer', { callId: callRow.id, conference: session.conference_name }),
        statusCallback: webhookUrl('/api/twilio/status', { callId: callRow.id }),
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      })
      await admin.from('calls').update({ call_sid: call.sid }).eq('id', callRow.id)
      return NextResponse.json({
        line: {
          callId: callRow.id,
          companyId: '',
          companyName: t.name || [t.title, t.city].filter(Boolean).join(' · ') || formatPhone(e164),
          phone: e164,
          kind: 'tech',
          techId: t.id,
        },
      })
    } catch (twilioError) {
      const message = twilioError instanceof Error ? twilioError.message : 'Dial failed.'
      await admin
        .from('calls')
        .update({ status: 'failed', ended_at: new Date().toISOString(), notes: `Manual dial failed: ${message}` })
        .eq('id', callRow.id)
      return NextResponse.json({ error: message }, { status: 502 })
    }
  }

  // Find or create the company this number belongs to.
  let { data: company } = await admin
    .from('companies')
    .select('id, name, do_not_call')
    .eq('phone', e164)
    .maybeSingle()

  if (!company) {
    const { data: created, error: createError } = await admin
      .from('companies')
      .insert({
        name: formatPhone(e164),
        phone: e164,
        owner_id: user.id,
        city: null,
        state: null,
        // Unknown until someone fills it in. `withinCallingHours` treats a null
        // timezone as callable, which is right here: the agent typed this
        // number deliberately.
        timezone: null,
        next_follow_up: null,
        notes: '',
        do_not_call: false,
      })
      .select('id, name, do_not_call')
      .single()

    if (createError || !created) {
      return NextResponse.json(
        { error: createError?.message ?? 'Could not create the company record.' },
        { status: 500 },
      )
    }
    company = created
  }

  // Do-not-call is a hard stop even for a hand-typed number. Someone who asked
  // not to be called did not ask conditionally on how they get dialed.
  if (company.do_not_call) {
    return NextResponse.json(
      { error: `${company.name} is marked do not call.` },
      { status: 409 },
    )
  }

  // Each rep dials through their own Twilio account, against its own cap.
  const account = await accountForAgent(user.id)
  const budget = await availableLines(account)
  if (budget.available < 1) {
    return NextResponse.json(
      { error: `Twilio's call limit (${budget.cap} at once, softphones included) is full right now. Try again in a moment.` },
      { status: 429 },
    )
  }

  const { data: callRow, error: callError } = await admin
    .from('calls')
    .insert({
      company_id: company.id,
      agent_id: user.id,
      session_id: sessionId,
      status: 'dialing',
    })
    .select('id')
    .single()

  if (callError || !callRow) {
    return NextResponse.json(
      { error: callError?.message ?? 'Could not create the call record.' },
      { status: 500 },
    )
  }

  try {
    const call = await twilioClient(account).calls.create({
      to: e164,
      // One of this rep's own numbers, rotated like batch lines.
      from: (await callerIdsFor(user.id))[0],
      timeout: DIAL_TIMEOUT_SECONDS,
      // No batchId: nothing to race against, so the answer webhook bridges
      // this leg straight through.
      url: webhookUrl('/api/twilio/answer', {
        callId: callRow.id,
        conference: session.conference_name,
      }),
      statusCallback: webhookUrl('/api/twilio/status', { callId: callRow.id }),
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    })

    const queued = Number(call.queueTime ?? 0)
    await admin
      .from('calls')
      .update({ call_sid: call.sid, notes: queued > 0 ? `Twilio queue time: ${Math.round(queued / 1000)}s` : null })
      .eq('id', callRow.id)

    return NextResponse.json({
      line: {
        callId: callRow.id,
        companyId: company.id,
        companyName: company.name,
        phone: e164,
      },
    })
  } catch (twilioError) {
    const message =
      twilioError instanceof Error ? twilioError.message : 'Dial failed.'

    await admin
      .from('calls')
      .update({
        status: 'failed',
        ended_at: new Date().toISOString(),
        notes: `Manual dial failed: ${message}`,
      })
      .eq('id', callRow.id)

    return NextResponse.json({ error: message }, { status: 502 })
  }
}
