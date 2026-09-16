import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { twilioClient, webhookUrl } from '@/lib/twilio/client'
import { env } from '@/lib/env'
import { withinCallingHours } from '@/lib/utils'
import { DIAL_TIMEOUT_SECONDS, DEFAULT_LINES_PER_BATCH } from '@/lib/constants'

export type BatchLine = {
  callId: string
  companyId: string
  companyName: string
  phone: string
}

/**
 * Fan out one batch of simultaneous calls.
 *
 * Lead selection and reservation happen inside `start_dial_batch` in one
 * transaction, so two reps hitting this at the same moment can never be handed
 * the same company. Twilio calls are created only after the rows exist -- if
 * the process dies mid-fan-out, the reserved rows are still there to reconcile
 * rather than being silently lost.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { sessionId, limit: wanted } = (await request.json()) as { sessionId?: string; limit?: number }
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: session, error: sessionError } = await admin
    .from('call_sessions')
    .select('id, agent_id, status, conference_name, lines_per_batch, live_call_id')
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

  // Never fan out while the rep is on a call: a pickup now would lose the
  // race and hang up on a real person for nothing.
  if (session.live_call_id) {
    const { data: live } = await admin.from('calls').select('ended_at').eq('id', session.live_call_id).maybeSingle()
    if (live && !live.ended_at) {
      return NextResponse.json({ error: 'A call is in progress.', busy: true }, { status: 409 })
    }
  }

  const perBatch = session.lines_per_batch ?? DEFAULT_LINES_PER_BATCH
  // A top-up asks for fewer lines than a full batch; never more.
  const limit = Math.max(1, Math.min(perBatch, Math.floor(Number(wanted) || perBatch)))

  const { data: reserved, error } = await admin.rpc('start_dial_batch', {
    p_session: sessionId,
    p_agent: user.id,
    p_limit: limit,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!reserved?.length) {
    return NextResponse.json({ lines: [], exhausted: true })
  }

  const batchId = reserved[0].batch_id

  // Calling-hours check happens here rather than in SQL: it needs a timezone
  // database, and Postgres would have to be told the local hour for each row.
  const { data: timezones } = await admin
    .from('companies')
    .select('id, timezone')
    .in(
      'id',
      reserved.map((r) => r.company_id),
    )

  const tzByCompany = new Map((timezones ?? []).map((c) => [c.id, c.timezone]))
  const now = new Date()

  const lines: BatchLine[] = []
  const skipped: string[] = []

  // One caller ID per line. With a single number, a four-line batch queues
  // behind that number's outbound rate limit and the legs ring seconds apart,
  // which quietly defeats the point of dialing in parallel. It also spreads
  // volume across the pool so no one number gets spam-flagged first.
  const callerIds = env.callerIds

  await Promise.all(
    reserved.map(async (lead, index) => {
      if (!withinCallingHours(tzByCompany.get(lead.company_id), now)) {
        skipped.push(lead.call_id)
        return
      }

      try {
        const call = await twilioClient().calls.create({
          to: lead.phone,
          from: callerIds[index % callerIds.length],
          timeout: DIAL_TIMEOUT_SECONDS,
          url: webhookUrl('/api/twilio/answer', {
            callId: lead.call_id,
            batchId,
            conference: session.conference_name,
          }),
          statusCallback: webhookUrl('/api/twilio/status', { callId: lead.call_id }),
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
          // No answering-machine detection: it misjudged real people, so the
          // first pickup wins outright and the rep hangs up on any voicemail.
        })

        await admin
          .from('calls')
          .update({ call_sid: call.sid })
          .eq('id', lead.call_id)

        lines.push({
          callId: lead.call_id,
          companyId: lead.company_id,
          companyName: lead.company_name,
          phone: lead.phone,
        })
      } catch (twilioError) {
        await admin
          .from('calls')
          .update({
            status: 'failed',
            ended_at: new Date().toISOString(),
            notes:
              twilioError instanceof Error
                ? `Dial failed: ${twilioError.message}`
                : 'Dial failed.',
          })
          .eq('id', lead.call_id)
      }
    }),
  )

  // Rows we never dialed must not linger as `dialing`, or the in-flight guard
  // will lock those companies out of the queue for two minutes.
  if (skipped.length > 0) {
    await admin
      .from('calls')
      .update({
        status: 'canceled',
        ended_at: new Date().toISOString(),
        notes: 'Outside calling hours for this prospect.',
      })
      .in('id', skipped)
  }

  return NextResponse.json({
    batchId,
    lines,
    skippedForHours: skipped.length,
    exhausted: false,
  })
}
