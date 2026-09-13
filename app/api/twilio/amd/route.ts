import { verifyTwilioRequest } from '@/lib/twilio/verify'
import { createAdminClient } from '@/lib/supabase/admin'
import { twilioClient } from '@/lib/twilio/client'
import { hangUpLosers } from '@/lib/twilio/calls'

/**
 * Async answering-machine detection result.
 *
 * Async on purpose: synchronous AMD holds the call in silence for a few seconds
 * before running any TwiML, and a person who says "hello" into dead air hangs
 * up. Async bridges immediately and reports a beat later.
 *
 * This is also where a parallel batch is decided. The first leg to pick up gets
 * the agent at once, but the others keep ringing until this verdict arrives. A
 * person means they are dropped. A machine means the voicemail is hung up and
 * the batch is handed back, so the next leg to pick up can still reach the
 * agent instead of a greeting costing three live prospects.
 */
const MACHINE = new Set([
  'machine_start',
  'machine_end_beep',
  'machine_end_silence',
  'machine_end_other',
  'fax',
])

export async function POST(request: Request) {
  const verified = await verifyTwilioRequest(request)
  if (!verified) return new Response('Forbidden', { status: 403 })

  const { params, url } = verified
  const callId = url.searchParams.get('callId')
  const answeredBy = params.AnsweredBy
  if (!callId || !answeredBy) return new Response(null, { status: 204 })

  const admin = createAdminClient()
  const { data: call } = await admin
    .from('calls')
    .update({ amd_result: answeredBy })
    .eq('id', callId)
    .select('call_sid, status, batch_id')
    .maybeSingle()

  // A leg that lost the race was already hung up; its verdict changes nothing.
  if (!call || call.status === 'canceled') return new Response(null, { status: 204 })

  if (!MACHINE.has(answeredBy)) {
    // 'human', or 'unknown' when detection hit its ceiling. Either way the
    // agent is talking to whoever this is, so the rest of the batch can go.
    if (call.batch_id) await hangUpLosers(call.batch_id, callId)
    return new Response(null, { status: 204 })
  }

  await admin
    .from('calls')
    .update({ status: 'voicemail', ended_at: new Date().toISOString() })
    .eq('id', callId)

  if (call.call_sid) {
    await twilioClient()
      .calls(call.call_sid)
      .update({ status: 'completed' })
      .catch(() => undefined)
  }

  if (call.batch_id) {
    // Hand the batch back. Guarded on this call still holding the claim, so a
    // verdict can only ever release its own leg.
    await admin
      .from('dial_batches')
      .update({ winner_call_id: null, resolved_at: null })
      .eq('id', call.batch_id)
      .eq('winner_call_id', callId)
  }

  return new Response(null, { status: 204 })
}
