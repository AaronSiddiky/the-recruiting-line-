import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** Switch a running session between the companies and techs queues. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { sessionId, queue } = (await request.json().catch(() => ({}))) as { sessionId?: string; queue?: string }
  if (!sessionId || (queue !== 'companies' && queue !== 'techs')) {
    return NextResponse.json({ error: 'sessionId and queue are required.' }, { status: 400 })
  }
  const admin = createAdminClient()
  const { data: session } = await admin.from('call_sessions').select('agent_id, status').eq('id', sessionId).maybeSingle()
  if (!session || session.agent_id !== user.id) return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
  if (session.status !== 'active') return NextResponse.json({ error: 'Session ended.' }, { status: 409 })
  await admin.from('call_sessions').update({ queue }).eq('id', sessionId)
  return NextResponse.json({ ok: true, queue })
}
