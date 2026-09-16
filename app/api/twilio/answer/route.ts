import { after } from 'next/server'
import twilio from 'twilio'
import { verifyTwilioRequest, twiml } from '@/lib/twilio/verify'
import { createAdminClient } from '@/lib/supabase/admin'
import { hangUpLosers, startRecording } from '@/lib/twilio/calls'
import { LOSING_LEG_BEHAVIOR, LOSING_LEG_WHISPER } from '@/lib/constants'

/**
 * A prospect picked up. This is the race.
 *
 * Four legs are ringing; two can answer within the same tens of milliseconds.
 * `claim_batch_winner` is an atomic compare-and-set in Postgres -- exactly one
 * caller gets `true`, everyone else gets `false`, no matter how close the two
 * webhooks land. Nothing here decides the winner in application code, because
 * anything we wrote by hand would be a check-then-act race.
 *
 * The winner's TwiML goes back immediately; the recording starts and the other
 * legs are hung up after the response is flushed, so the person who just said
 * "hello" is not listening to silence. There is no answering-machine
 * detection: the first pickup wins, voicemail or not, and the rep hangs up on
 * a greeting and moves on.
 */
export async function POST(request: Request) {
  const verified = await verifyTwilioRequest(request)
  if (!verified) return new Response('Forbidden', { status: 403 })

  const { params, url } = verified
  const callId = url.searchParams.get('callId')
  const batchId = url.searchParams.get('batchId')
  const conference = url.searchParams.get('conference')

  const response = new twilio.twiml.VoiceResponse()

  if (!callId || !conference) {
    response.hangup()
    return twiml(response.toString())
  }

  const admin = createAdminClient()

  // A leg that dials late out of Twilio's queue, after we cancelled it or after
  // the session ended, must not be bridged into an empty or busy room.
  const { data: leg } = await admin
    .from('calls')
    .select('ended_at, session_id, session:call_sessions!calls_session_id_fkey(status)')
    .eq('id', callId)
    .maybeSingle()
  const sessionStatus = (leg?.session as { status?: string } | null)?.status
  if (!leg || leg.ended_at || sessionStatus !== 'active') {
    response.hangup()
    return twiml(response.toString())
  }

  // A manual dial from the dial pad has no batch and therefore no race: it is
  // one number the agent typed, so it wins by definition. Only a fanned-out
  // batch needs the arbiter.
  let lost = false
  if (batchId) {
    const { data: won, error } = await admin.rpc('claim_batch_winner', {
      p_batch_id: batchId,
      p_call_id: callId,
    })
    // Fail closed. If the arbiter is unreachable we hang up rather than risk
    // bridging two prospects into the same conference.
    lost = error != null || won !== true

    // A leg whose batch row is gone (a queue-function bug deleted it) still
    // belongs to a session. Claim that session's live slot directly: the
    // UPDATE ... WHERE live_call_id IS NULL is atomic, same as the RPC.
    if (lost && !error) {
      const { data: batch } = await admin.from('dial_batches').select('id').eq('id', batchId).maybeSingle()
      if (!batch) {
        const sessionId = (leg as { session_id?: string }).session_id ?? ''
        const { data: claimed } = await admin
          .from('call_sessions')
          .update({ live_call_id: callId })
          .eq('id', sessionId)
          .is('live_call_id', null)
          .select('id')
        lost = !claimed?.length
        if (lost) {
          // The slot still names the previous call; free if that call ended.
          const { data: current } = await admin
            .from('call_sessions')
            .select('live_call_id, live:calls!call_sessions_live_call_id_fkey(ended_at)')
            .eq('id', sessionId)
            .maybeSingle()
          const previous = current?.live_call_id
          const previousEnded = !!(current?.live as { ended_at?: string | null } | null)?.ended_at
          if (previous && previousEnded) {
            const { data: reclaimed } = await admin
              .from('call_sessions')
              .update({ live_call_id: callId })
              .eq('id', sessionId)
              .eq('live_call_id', previous)
              .select('id')
            lost = !reclaimed?.length
          }
        }
      }
    }
  }

  if (lost) {
    after(async () => {
      const now = new Date().toISOString()
      // answered_at records that a person picked up and heard us hang up, which
      // is a different thing from a leg that stopped ringing unanswered.
      await admin
        .from('calls')
        .update({ status: 'canceled', answered_at: now, ended_at: now })
        .eq('id', callId)
    })

    if (LOSING_LEG_BEHAVIOR === 'whisper') {
      response.say({ voice: 'Polly.Joanna' }, LOSING_LEG_WHISPER)
    }
    response.hangup()
    return twiml(response.toString())
  }

  const callSid = params.CallSid

  after(async () => {
    await admin
      .from('calls')
      .update({
        status: 'connected',
        answered_at: new Date().toISOString(),
        call_sid: callSid,
      })
      .eq('id', callId)

    if (batchId) await hangUpLosers(batchId, callId)

    try {
      await startRecording(callSid, callId)
    } catch {
      // A missing recording must not drop a live conversation. The call stays
      // connected; the company page will show "no recording".
    }
  })

  const dial = response.dial()
  dial.conference(
    {
      beep: 'false',
      // The agent is already parked in the room and owns its lifetime.
      startConferenceOnEnter: true,
      endConferenceOnExit: false,
    },
    conference,
  )

  return twiml(response.toString())
}
