import twilio from 'twilio'
import { verifyTwilioRequest, twiml } from '@/lib/twilio/verify'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * TwiML served to the agent's browser device when it dials in. Parks the agent
 * in their session conference, where leads will be bridged to them.
 *
 * The agent is the conference owner: `endConferenceOnExit` means hanging up the
 * softphone tears down any live call rather than leaving a prospect talking to
 * an empty room.
 */
export async function POST(request: Request) {
  const verified = await verifyTwilioRequest(request)
  if (!verified) {
    return new Response('Forbidden', { status: 403 })
  }

  const sessionId = verified.params.sessionId
  const response = new twilio.twiml.VoiceResponse()

  if (!sessionId) {
    response.say('No dialing session was supplied.')
    response.hangup()
    return twiml(response.toString())
  }

  const admin = createAdminClient()
  const { data: session } = await admin
    .from('call_sessions')
    .select('conference_name, status')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session || session.status !== 'active') {
    response.say('That dialing session is no longer active.')
    response.hangup()
    return twiml(response.toString())
  }

  const dial = response.dial({ answerOnBridge: true })
  dial.conference(
    {
      beep: 'false',
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      // Silence, not hold music -- the agent sits here between every batch.
      waitUrl: '',
    },
    session.conference_name,
  )

  return twiml(response.toString())
}
