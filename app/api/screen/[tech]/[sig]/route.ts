import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyTech } from '@/lib/techs/screen-link'

const bodySchema = z.object({
  looking: z.boolean(),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  city: z.string().trim().max(100).optional(),
  current_job: z.string().trim().max(200).optional(),
  years_hvac: z.number().min(0).max(60).nullable().optional(),
  role_pref: z.enum(['install', 'service', 'both']).nullable().optional(),
  epa_cert: z.enum(['none', 'type1', 'type2', 'type3', 'universal']).nullable().optional(),
  own_tools: z.boolean().nullable().optional(),
  drivers_license: z.boolean().nullable().optional(),
  commission_ok: z.boolean().nullable().optional(),
  pay_min: z.number().int().min(0).max(500).nullable().optional(),
  available_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  max_commute_miles: z.number().int().min(0).max(300).nullable().optional(),
  note: z.string().trim().max(2000).optional(),
})

/**
 * The tech's own answers. No sign-in: the signed link is the credential, and
 * it only ever writes to that one tech's row.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/screen/[tech]/[sig]'>) {
  const { tech, sig } = await ctx.params
  if (!verifyTech(tech, sig)) return NextResponse.json({ error: 'That link is not valid.' }, { status: 403 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Some answers were not understood.' }, { status: 400 })
  const a = parsed.data

  const admin = createAdminClient()
  const { data: existing } = await admin.from('techs').select('id, name, status, notes').eq('id', tech).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'That link is not valid.' }, { status: 404 })
  const current = existing as { id: string; name: string | null; status: string; notes: string }

  const patch: Record<string, unknown> = {
    looking: a.looking,
    screening_at: new Date().toISOString(),
  }
  if (a.name && !current.name) patch.name = a.name
  if (a.email) patch.email = a.email.toLowerCase()
  if (a.city) patch.city = a.city
  if (a.current_job) patch.current_job = a.current_job
  for (const k of ['years_hvac', 'role_pref', 'epa_cert', 'own_tools', 'drivers_license', 'commission_ok', 'pay_min', 'available_from', 'max_commute_miles'] as const) {
    if (a[k] !== undefined) patch[k] = a[k]
  }
  if (a.note) patch.notes = [current.notes, `From the screening form: ${a.note}`].filter(Boolean).join('\n')

  // Answers move them to Screened, unless they are already further along or
  // told us they are not looking.
  const early = ['new', 'reviewing', 'contacting'].includes(current.status)
  if (!a.looking) patch.next_follow_up = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)
  else if (early) patch.status = 'screened'

  const { error } = await admin.from('techs').update(patch as never).eq('id', tech)
  if (error) {
    const missing = /column .* does not exist|schema cache/i.test(error.message)
    console.error('Screening form save failed', error.message)
    return NextResponse.json(
      {
        error: missing
          ? 'The screening form is not switched on yet. Run supabase/migrations/0024_screening_form.sql.'
          : 'Could not save your answers.',
      },
      { status: 500 },
    )
  }

  await admin.from('tech_touchpoints').insert({
    tech_id: tech,
    channel: 'other',
    summary: a.looking
      ? `Filled in the screening form${a.years_hvac != null ? ` — ${a.years_hvac} yrs` : ''}${a.role_pref ? `, ${a.role_pref}` : ''}${a.available_from ? `, can start ${a.available_from}` : ''}`
      : 'Filled in the screening form — not looking right now',
    next_touch: a.looking ? null : new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
  } as never)

  return NextResponse.json({ ok: true })
}
