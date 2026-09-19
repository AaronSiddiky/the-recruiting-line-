import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const bodySchema = z.object({
  outcome: z.enum(['meeting_booked', 'not_interested', 'wrong_number', 'call_back', 'customer', 'no_answer', 'not_hiring']),
  notes: z.string().max(10_000).optional(),
  nextFollowUp: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  email: z.string().trim().email().max(200).optional(),
  /** Only meaningful on a call to a technician; ignored otherwise. */
  tech: z
    .object({
      years_hvac: z.number().min(0).max(60).optional(),
      role_pref: z.enum(['install', 'service', 'both']).optional(),
      epa_cert: z.enum(['none', 'type1', 'type2', 'type3', 'universal']).optional(),
      own_tools: z.boolean().optional(),
      commission_ok: z.boolean().optional(),
      pay_min: z.number().int().min(0).max(500).optional(),
      interview_at: z.string().datetime({ offset: true }).optional(),
      stage: z.enum(['contacting', 'screened', 'interviewing', 'presented', 'placed', 'rejected']).optional(),
    })
    .optional(),
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

  const { outcome, notes, nextFollowUp, email, tech: techInput } = parsed.data

  // RLS restricts this to the agent who made the call.
  const { data: call, error } = await supabase
    .from('calls')
    .update({ outcome, notes: notes ?? null })
    .eq('id', id)
    .select('id, company_id, tech_id')
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

  if (call.tech_id) {
    // A tech call is a touch point. The database schedules the next touch a
    // week out; outcomes that imply a different date pass it explicitly.
    const next =
      outcome === 'no_answer'
        ? (nextFollowUp ?? daysFromNowUtc(1))
        : outcome === 'call_back'
          ? (nextFollowUp ?? null)
          : null
    const label: Record<string, string> = {
      meeting_booked: 'Interested', call_back: 'Call back', no_answer: 'No answer', not_interested: 'Not interested',
      wrong_number: 'Wrong number', customer: 'Placed', not_hiring: 'Not available right now',
    }
    await supabase.from('tech_touchpoints').insert({
      tech_id: call.tech_id,
      user_id: user.id,
      channel: 'call',
      summary: [label[outcome] ?? outcome, notes?.trim()].filter(Boolean).join(' — '),
      next_touch: next,
      call_id: call.id,
    } as never)

    const { data: tech } = await supabase.from('techs').select('status').eq('id', call.tech_id).single()
    const current = (tech as { status?: string } | null)?.status ?? 'new'
    const order = ['new', 'reviewing', 'contacting', 'screened', 'interviewing', 'presented', 'placed']
    const techPatch: Record<string, unknown> = {}

    if (techInput) {
      const { stage, ...screening } = techInput
      Object.assign(techPatch, screening)
      // Never walk a tech backwards: a rep who books an interview with someone
      // already presented to a client should not undo that.
      if (stage) {
        const terminal = stage === 'rejected' || stage === 'placed'
        if (terminal || order.indexOf(stage) > order.indexOf(current)) techPatch.status = stage
      }
    } else {
      // A company-shaped submission on a tech call (older client build).
      const early = current === 'new' || current === 'reviewing' || current === 'contacting'
      if (outcome === 'customer') techPatch.status = 'placed'
      else if (outcome === 'not_interested' || outcome === 'wrong_number') techPatch.status = 'rejected'
      else if (outcome === 'meeting_booked' && early) techPatch.status = 'screened'
      else if (current === 'new' || current === 'reviewing') techPatch.status = 'contacting'
    }
    if (email) techPatch.email = email
    if (Object.keys(techPatch).length) await supabase.from('techs').update(techPatch as never).eq('id', call.tech_id)
  } else if (call.company_id && Object.keys(companyPatch).length > 0) {
    await supabase.from('companies').update(companyPatch).eq('id', call.company_id)
  }

  return NextResponse.json({ ok: true })
}

function daysFromNowUtc(days: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
