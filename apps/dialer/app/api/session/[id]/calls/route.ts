import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Every call row in one dialing session: the dialer's polling fallback.
 *
 * Realtime is the fast path for call state, but it can stop without an error,
 * and a dialer that quietly freezes mid-call is the failure agents trust least.
 * The browser polls this to reconcile. It reads under the agent's own session,
 * so RLS scopes it exactly as it scopes everything else.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/session/[id]/calls'>) {
  const { id } = await ctx.params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { data: session } = await supabase
    .from('call_sessions')
    .select('id, agent_id, status')
    .eq('id', id)
    .maybeSingle()

  if (!session || session.agent_id !== user.id) {
    return NextResponse.json({ error: 'Not your session.' }, { status: 403 })
  }

  const { data: calls, error } = await supabase
    .from('calls')
    .select(
      'id, company_id, status, amd_result, outcome, started_at, answered_at, ended_at, duration_seconds, notes, updated_at',
    )
    .eq('session_id', id)
    .order('started_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    { sessionStatus: session.status, calls: calls ?? [] },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
