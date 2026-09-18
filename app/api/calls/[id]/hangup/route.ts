import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { twilioClient } from '@/lib/twilio/client'
import { accountForAgent } from '@/lib/twilio/accounts'

/**
 * Drop one leg without leaving the conference.
 *
 * The prospect's leg is `endConferenceOnExit: false`, so ending it returns the
 * agent to an empty room ready for the next batch rather than tearing down
 * their softphone connection.
 */
export async function POST(
  _request: NextRequest,
  ctx: RouteContext<'/api/calls/[id]/hangup'>,
) {
  const { id } = await ctx.params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const admin = createAdminClient()
  const { data: call } = await admin
    .from('calls')
    .select('id, call_sid, agent_id, status')
    .eq('id', id)
    .maybeSingle()

  if (!call || call.agent_id !== user.id) {
    return NextResponse.json({ error: 'Not your call.' }, { status: 403 })
  }

  if (call.call_sid) {
    await twilioClient(await accountForAgent(call.agent_id))
      .calls(call.call_sid)
      .update({ status: 'completed' })
      .catch(() => undefined)
  }

  // The status webhook writes ended_at; setting it here too means the UI
  // advances immediately instead of waiting on Twilio's callback.
  await admin
    .from('calls')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
