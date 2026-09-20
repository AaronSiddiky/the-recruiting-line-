import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { screenUrl } from '@/lib/techs/screen-link'

type PriorCall = {
  id: string
  started_at: string
  outcome: string | null
  notes: string | null
  duration_seconds: number | null
  agent: { full_name: string } | null
}

/**
 * What we already know about the person on this call: earlier calls with
 * their dispositions, and, for a technician, the screening card as it stands.
 *
 * The exit interview uses it so a second call starts from what was said the
 * first time instead of an empty form.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/calls/[id]/context'>) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { data: call } = await supabase.from('calls').select('id, tech_id, company_id, agent_id').eq('id', id).maybeSingle()
  if (!call) return NextResponse.json({ error: 'No such call.' }, { status: 404 })

  const select = 'id, started_at, outcome, notes, duration_seconds, agent:profiles!calls_agent_id_fkey(full_name)'
  let query = supabase.from('calls').select(select).neq('id', id).neq('status', 'canceled').order('started_at', { ascending: false }).limit(5)
  query = call.tech_id ? query.eq('tech_id', call.tech_id) : call.company_id ? query.eq('company_id', call.company_id) : query.eq('id', id)
  const { data: previous } = await query

  let tech = null
  if (call.tech_id) {
    const { data } = await supabase
      .from('techs')
      .select('name, status, years_hvac, role_pref, epa_cert, own_tools, commission_ok, pay_min, rating, interview_at, next_follow_up')
      .eq('id', call.tech_id)
      .maybeSingle()
    tech = data
  }

  const rows = ((previous ?? []) as unknown as PriorCall[]).filter((p) => p.outcome || p.notes)
  return NextResponse.json(
    { previous: rows, tech, isTech: !!call.tech_id, screenUrl: call.tech_id ? screenUrl(call.tech_id) : null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
