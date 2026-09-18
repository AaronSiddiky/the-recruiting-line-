import { NextResponse, type NextRequest } from 'next/server'
import twilio from 'twilio'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { twilioClient } from '@/lib/twilio/client'
import { accountForAgent } from '@/lib/twilio/accounts'

/**
 * Drop the rep's pre-recorded message into a live call and hang it up.
 *
 * The prospect's leg is redirected out of the conference to new TwiML that
 * plays the message and hangs up. The agent's leg is untouched, so they are
 * back in an empty room immediately while Twilio finishes talking to the
 * machine. The call is marked ended here so the exit interview opens at once.
 */
export async function POST(
  _request: NextRequest,
  ctx: RouteContext<'/api/calls/[id]/voicemail'>,
) {
  const { id } = await ctx.params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const admin = createAdminClient()
  const [{ data: call }, { data: profile }] = await Promise.all([
    admin.from('calls').select('id, call_sid, agent_id, status').eq('id', id).maybeSingle(),
    admin.from('profiles').select('voicemail_path').eq('id', user.id).maybeSingle(),
  ])

  if (!call || call.agent_id !== user.id) {
    return NextResponse.json({ error: 'Not your call.' }, { status: 403 })
  }
  if (call.status !== 'connected' || !call.call_sid) {
    return NextResponse.json({ error: 'That call is not live.' }, { status: 409 })
  }
  if (!profile?.voicemail_path) {
    return NextResponse.json(
      { error: 'Record a voicemail message first, on the dialer home screen.' },
      { status: 412 },
    )
  }

  const { data: signed, error: signError } = await admin.storage
    .from('voicemails')
    .createSignedUrl(profile.voicemail_path, 60 * 15)
  if (signError || !signed) {
    return NextResponse.json({ error: 'Could not load your voicemail message.' }, { status: 500 })
  }

  const response = new twilio.twiml.VoiceResponse()
  response.play(signed.signedUrl)
  response.hangup()

  try {
    await twilioClient(await accountForAgent(call.agent_id)).calls(call.call_sid).update({ twiml: response.toString() })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Twilio refused the redirect.' },
      { status: 502 },
    )
  }

  const now = new Date().toISOString()
  await admin
    .from('calls')
    .update({ voicemail_left_at: now, ended_at: now })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
