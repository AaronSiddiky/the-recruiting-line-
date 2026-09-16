import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hangUpSession } from '@/lib/twilio/calls'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { sessionId } = (await request.json()) as { sessionId?: string }
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: session } = await admin
    .from('call_sessions')
    .select('id, agent_id')
    .eq('id', sessionId)
    .maybeSingle()

  if (!session || session.agent_id !== user.id) {
    return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
  }

  await hangUpSession(sessionId)
  const now = new Date().toISOString()
  // Legs still ringing when the session ends are hung up at Twilio above;
  // close them here too so a missed callback cannot leave them "dialing".
  await admin
    .from('calls')
    .update({ status: 'canceled', ended_at: now, notes: 'Session ended while this line was still ringing.' })
    .eq('session_id', sessionId)
    .in('status', ['dialing', 'ringing'])
    .is('ended_at', null)
  await admin
    .from('call_sessions')
    .update({ status: 'ended', ended_at: now })
    .eq('id', sessionId)

  return NextResponse.json({ ok: true })
}
