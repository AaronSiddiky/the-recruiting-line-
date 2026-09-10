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
  await admin
    .from('call_sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', sessionId)

  return NextResponse.json({ ok: true })
}
