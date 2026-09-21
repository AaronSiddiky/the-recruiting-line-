import 'server-only'
import { twilioClient, webhookUrl } from '@/lib/twilio/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { accountForCall, accountForSession } from '@/lib/twilio/accounts'

/**
 * Hang up any other leg of this session that is still ringing.
 *
 * With one call out at a time there should never be another, so this is a
 * safety net rather than part of the dial path: a leg that dialled late out of
 * Twilio's queue, or one whose status webhook never arrived, would otherwise
 * ring a prospect nobody is waiting to talk to.
 *
 * Runs after the TwiML response is flushed -- the prospect who just picked up
 * must not wait on a REST round-trip before they hear the rep. Failures are
 * swallowed per leg: a leg that already ended returns a 20009, which is a
 * normal outcome here and not worth failing the call over.
 */
export async function hangUpStrays(sessionId: string, keepCallId: string) {
  const admin = createAdminClient()

  const { data: strays } = await admin
    .from('calls')
    .select('id, call_sid')
    .eq('session_id', sessionId)
    .neq('id', keepCallId)
    .in('status', ['dialing', 'ringing'])

  if (!strays?.length) return

  const account = await accountForSession(sessionId)
  const now = new Date().toISOString()

  await admin
    .from('calls')
    .update({ status: 'canceled', ended_at: now })
    .in(
      'id',
      strays.map((l) => l.id),
    )

  await Promise.allSettled(
    strays
      .filter((l) => l.call_sid)
      .map((l) =>
        twilioClient(account)
          .calls(l.call_sid!)
          .update({ status: 'completed' })
          .catch(() => undefined),
      ),
  )
}

/**
 * Start recording the connected leg, dual-channel.
 *
 * Dual channel puts the prospect on one track and the conference (the agent)
 * on the other, which is what makes the transcript attributable to a speaker.
 * A mixed conference recording would collapse both into one channel and the
 * summary quality drops with it.
 *
 * Recording starts here rather than at call creation so an unanswered leg
 * never leaves a few seconds of ringing in storage.
 */
export async function startRecording(callSid: string, callId: string) {
  const recording = await twilioClient(await accountForCall(callId))
    .calls(callSid)
    .recordings.create({
      recordingChannels: 'dual',
      recordingStatusCallback: webhookUrl('/api/twilio/recording', { callId }),
      recordingStatusCallbackEvent: ['completed'],
    })

  await createAdminClient()
    .from('calls')
    .update({ recording_sid: recording.sid })
    .eq('id', callId)
}

/** Hang up any leg still in flight. Used when a session ends. */
export async function hangUpSession(sessionId: string) {
  const admin = createAdminClient()

  const { data: live } = await admin
    .from('calls')
    .select('id, call_sid')
    .eq('session_id', sessionId)
    .in('status', ['dialing', 'ringing', 'connected'])

  if (!live?.length) return

  const account = await accountForSession(sessionId)
  await Promise.allSettled(
    live
      .filter((c) => c.call_sid)
      .map((c) =>
        twilioClient(account)
          .calls(c.call_sid!)
          .update({ status: 'completed' })
          .catch(() => undefined),
      ),
  )
}
