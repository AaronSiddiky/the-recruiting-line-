import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  outcome: z.enum(['meeting_booked', 'not_interested', 'wrong_number', 'call_back', 'customer', 'no_answer', 'not_hiring']),
  notes: z.string().max(10_000).optional(),
  nextFollowUp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  email: z.string().trim().email().max(200).optional(),
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

  const { outcome, notes, nextFollowUp, email } = parsed.data

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
  // the follow-up write is part of the same submission. Same for an email the
  // prospect just read out: it lives on the company, not the call.
  const companyPatch: { next_follow_up?: string; email?: string } = {}
  if (outcome === 'call_back' && nextFollowUp) companyPatch.next_follow_up = nextFollowUp
  // "No answer" always comes back tomorrow. The browser sends its local
  // tomorrow; fall back to UTC so the lead never lands in the queue undated.
  if (outcome === 'no_answer') companyPatch.next_follow_up = nextFollowUp ?? daysFromNowUtc(1)
  // "Not interested" is a snooze, not a burial: back in the queue in a month.
  if (outcome === 'not_interested' || outcome === 'not_hiring') {
    companyPatch.next_follow_up = nextFollowUp ?? daysFromNowUtc(30)
  }
  if (email) companyPatch.email = email
  if (Object.keys(companyPatch).length > 0) {
    await supabase.from('companies').update(companyPatch).eq('id', call.company_id)
  }

  return NextResponse.json({ ok: true })
}

function daysFromNowUtc(days: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
