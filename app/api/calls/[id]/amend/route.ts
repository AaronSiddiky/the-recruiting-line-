import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  outcome: z.enum(['meeting_booked', 'not_interested', 'wrong_number', 'call_back', 'customer', 'no_answer', 'not_hiring']).optional(),
  notes: z.string().max(10_000).nullable().optional(),
})

/**
 * Correct an earlier call's disposition or notes.
 *
 * Deliberately narrow: it touches that one call row and nothing else. No
 * touch point is logged and no follow-up is rescheduled, because fixing what
 * was written last week should not make the system think we spoke today.
 * RLS still restricts it to the rep who made the call, or a manager.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/calls/[id]/amend'>) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || (parsed.data.outcome === undefined && parsed.data.notes === undefined)) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  }

  const { data, error } = await supabase.from('calls').update(parsed.data).eq('id', id).select('id').single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not save.' }, { status: 403 })
  return NextResponse.json({ ok: true })
}
