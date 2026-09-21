import { after } from 'next/server'
import twilio from 'twilio'
import { verifyTwilioRequest, twiml } from '@/lib/twilio/verify'
import { createAdminClient } from '@/lib/supabase/admin'
import { hangUpStrays, startRecording } from '@/lib/twilio/calls'

/**
 * A prospect picked up. Bridge them to the rep.
 *
 * The rep has exactly one line out at a time, so there is no longer a race
 * between legs of the same batch -- but a session still has exactly one live
 * slot, and a leg that dialled late out of Twilio's queue can arrive after the
 * rep is already talking to someone else. `claim_batch_winner` is an atomic
 * compare-and-set in Postgres that hands that slot to exactly one call; a leg
 * that does not get it is hung up rather than bridged into an occupied room.
 *
 * TwiML goes back immediately; the recording starts after the response is
 * flushed, so the person who just said "hello" is not listening to silence.
 * There is no answering-machine detection: the rep hangs up on a greeting and
 * moves on.
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

  // A manual dial from the dial pad carries no batch id and skips the claim:
  // the rep typed that number a moment ago, so it is the call they are waiting
  // for by definition.
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
    // belongs to a session. Claim that session's line directly: the
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

    const sessionId = (leg as { session_id?: string }).session_id
    if (sessionId) await hangUpStrays(sessionId, callId)

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
      // The rep is already parked in the room and owns its lifetime.
      startConferenceOnEnter: true,
      endConferenceOnExit: false,
    },
    conference,
  )

  return twiml(response.toString())
}
