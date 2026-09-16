import 'server-only'
import { twilioClient, webhookUrl } from '@/lib/twilio/client'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Hang up every other ringing leg in the session the instant we have a winner.
 *
 * Session-wide, not batch-wide: with continuous top-ups, legs from several
 * batches ring at once and all of them must drop when one prospect answers.
 *
 * Runs after the TwiML response is flushed -- the winning prospect must not
 * wait on three REST round-trips before they hear the agent. Failures are
 * swallowed per leg: a leg that already ended returns a 20009 and that is a
 * normal outcome of the race, not an error worth failing the call over.
 */
export async function hangUpOthers(sessionId: string, winnerCallId: string) {
  const admin = createAdminClient()

  const { data: losers } = await admin
    .from('calls')
    .select('id, call_sid')
    .eq('session_id', sessionId)
    .neq('id', winnerCallId)
    .in('status', ['dialing', 'ringing'])

  if (!losers?.length) return

  const now = new Date().toISOString()

  await admin
    .from('calls')
    .update({ status: 'canceled', ended_at: now })
    .in(
      'id',
      losers.map((l) => l.id),
    )

  await Promise.allSettled(
    losers
      .filter((l) => l.call_sid)
      .map((l) =>
        twilioClient()
          .calls(l.call_sid!)
          .update({ status: 'completed' })
          .catch(() => undefined),
      ),
  )
}

/** Batch-keyed wrapper for callers that only know the batch. */
export async function hangUpLosers(batchId: string, winnerCallId: string) {
  const { data: batch } = await createAdminClient()
    .from('dial_batches')
    .select('session_id')
    .eq('id', batchId)
    .maybeSingle()
  if (batch?.session_id) await hangUpOthers(batch.session_id, winnerCallId)
}

/**
 * Start recording the winning leg, dual-channel.
 *
 * Dual channel puts the prospect on one track and the conference (the agent)
 * on the other, which is what makes the transcript attributable to a speaker.
 * A mixed conference recording would collapse both into one channel and the
 * summary quality drops with it.
 *
 * Recording starts here rather than at call creation so we never pay to store
 * three seconds of audio for each of the three legs we hang up on.
 */
export async function startRecording(callSid: string, callId: string) {
  const recording = await twilioClient()
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

  await Promise.allSettled(
    live
      .filter((c) => c.call_sid)
      .map((c) =>
        twilioClient()
          .calls(c.call_sid!)
          .update({ status: 'completed' })
          .catch(() => undefined),
      ),
  )
}
