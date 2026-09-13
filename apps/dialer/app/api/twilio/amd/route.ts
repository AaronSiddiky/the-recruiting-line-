import { verifyTwilioRequest } from '@/lib/twilio/verify'
import { createAdminClient } from '@/lib/supabase/admin'
import { twilioClient } from '@/lib/twilio/client'

/**
 * Async answering-machine detection result.
 *
 * We run AMD in async mode deliberately: synchronous AMD makes Twilio hold the
 * call for three-ish seconds of silence before executing any TwiML, and a live
 * human who says "hello" into dead air hangs up. Async bridges immediately and
 * tells us what it decided a beat later. The cost is that the agent may hear a
 * second or two of a voicemail greeting before we pull the plug -- the right
 * trade for a dialer whose whole point is talking to people.
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
  if (!callId || !answeredBy) return new Response('', { status: 204 })

  const admin = createAdminClient()
  await admin.from('calls').update({ amd_result: answeredBy }).eq('id', callId)

  if (!MACHINE.has(answeredBy)) return new Response('', { status: 204 })

  const { data: call } = await admin
    .from('calls')
    .select('call_sid, status')
    .eq('id', callId)
    .maybeSingle()

  if (!call || call.status === 'canceled') return new Response('', { status: 204 })

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

  return new Response('', { status: 204 })
}
