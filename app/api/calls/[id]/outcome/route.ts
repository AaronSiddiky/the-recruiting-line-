import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  outcome: z.enum(['meeting_booked', 'not_interested', 'wrong_number', 'call_back']),
  notes: z.string().max(10_000).optional(),
  nextFollowUp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

/**
 * Submit the exit interview.
 *
 * Writing the outcome onto the call row is what drives the company's CRM
 * `response` -- a trigger recomputes it from the most recent dispositioned
 * call, so there is exactly one place the disposition is authored.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/calls/[id]/outcome'>,
) {
  const { id } = await ctx.params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid exit interview.' }, { status: 400 })
  }

  const { outcome, notes, nextFollowUp } = parsed.data

  // RLS restricts this to the agent who made the call.
  const { data: call, error } = await supabase
    .from('calls')
    .update({ outcome, notes: notes ?? null })
    .eq('id', id)
    .select('id, company_id')
    .single()

  if (error || !call) {
    return NextResponse.json(
      { error: error?.message ?? 'Could not save.' },
      { status: 403 },
    )
  }

  // "Call back" without a date is how leads quietly fall out of a pipeline, so
  // the follow-up write is part of the same submission.
  if (outcome === 'call_back' && nextFollowUp) {
    await supabase
      .from('companies')
      .update({ next_follow_up: nextFollowUp })
      .eq('id', call.company_id)
  }

  return NextResponse.json({ ok: true })
}
