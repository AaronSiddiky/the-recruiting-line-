import { verifyTwilioRequest } from '@/lib/twilio/verify'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Call, CallStatus } from '@/types/db'

/**
 * Statuses we will never overwrite from a generic status callback.
 *
 * `canceled` and `voicemail` are conclusions our own logic reached with more
 * context than Twilio has: Twilio reports a leg we deliberately killed as
 * "completed", which would otherwise erase the fact that the prospect never
 * heard us and inflate their call count.
 */
const TERMINAL: CallStatus[] = ['canceled', 'voicemail', 'connected']

const STATUS_MAP: Record<string, CallStatus> = {
  ringing: 'ringing',
  'no-answer': 'no_answer',
  busy: 'busy',
  failed: 'failed',
  canceled: 'canceled',
}

export async function POST(request: Request) {
  const verified = await verifyTwilioRequest(request)
  if (!verified) return new Response('Forbidden', { status: 403 })

  const { params, url } = verified
  const callId = url.searchParams.get('callId')
  if (!callId) return new Response('', { status: 204 })

  const admin = createAdminClient()
  const { data: call } = await admin
    .from('calls')
    .select('status')
    .eq('id', callId)
    .maybeSingle()

  if (!call) return new Response('', { status: 204 })

  const twilioStatus = params.CallStatus
  const patch: Partial<Call> = {}

  if (twilioStatus === 'completed') {
    patch.ended_at = new Date().toISOString()
    if (params.CallDuration) {
      patch.duration_seconds = Number(params.CallDuration)
    }
    // Answered but never bridged: the batch was won by someone else, or the
    // prospect hung up during AMD. Either way it is not a conversation.
    if (call.status === 'dialing' || call.status === 'ringing') {
      patch.status = 'no_answer'
    }
  } else {
    const mapped = STATUS_MAP[twilioStatus]
    if (mapped && !TERMINAL.includes(call.status)) {
      patch.status = mapped
      if (mapped !== 'ringing') patch.ended_at = new Date().toISOString()
    }
  }

  if (Object.keys(patch).length > 0) {
    await admin.from('calls').update(patch).eq('id', callId)
  }

  return new Response('', { status: 204 })
}
