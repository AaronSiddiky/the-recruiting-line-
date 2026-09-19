import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhone } from '@/lib/utils'

const bodySchema = z.object({ kind: z.enum(['company', 'tech']) })

/**
 * Switch a finished call between "this was a shop" and "this was a
 * technician", so the rep gets the right exit interview.
 *
 * A number dialed by hand lands wherever it was first seen. Turning one into a
 * tech call creates (or reuses) the tech record for that number; the
 * placeholder company the manual dial invented is deleted when nothing else
 * refers to it.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/calls/[id]/kind'>) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: call } = await admin
    .from('calls')
    .select('id, agent_id, company_id, tech_id, company:companies(id, name, phone, call_count)')
    .eq('id', id)
    .maybeSingle()
  if (!call || call.agent_id !== user.id) return NextResponse.json({ error: 'Not your call.' }, { status: 403 })

  const company = call.company as unknown as { id: string; name: string; phone: string; call_count: number } | null

  if (parsed.data.kind === 'tech') {
    if (call.tech_id) return NextResponse.json({ ok: true, techId: call.tech_id })
    const phone = company?.phone
    if (!phone) return NextResponse.json({ error: 'That call has no number to go on.' }, { status: 409 })

    const { data: existing } = await admin.from('techs').select('id, name').eq('phone', phone).maybeSingle()
    let techId = (existing as { id: string } | null)?.id
    let name = (existing as { name: string | null } | null)?.name ?? null
    if (!techId) {
      // A placeholder company name is just the formatted number; don't carry it over.
      const placeholder = company && company.name === formatPhone(company.phone)
      const { data: created, error } = await admin
        .from('techs')
        .insert({
          name: placeholder ? null : (company?.name ?? null),
          phone,
          source: 'Called by hand',
          status: 'contacting',
          owner_id: user.id,
          notes: 'Added from a hand-dialed call.',
        })
        .select('id, name')
        .single()
      if (error || !created) return NextResponse.json({ error: error?.message ?? 'Could not create the tech.' }, { status: 500 })
      techId = created.id
      name = created.name
    }

    await admin.from('calls').update({ tech_id: techId, company_id: null }).eq('id', id)
    // Drop the invented company if this was its only call.
    if (company && company.name === formatPhone(company.phone) && (company.call_count ?? 0) <= 1) {
      await admin.from('companies').delete().eq('id', company.id)
    }
    return NextResponse.json({ ok: true, techId, name })
  }

  // Back to a company call: find or create the company for that number.
  if (!call.tech_id) return NextResponse.json({ ok: true, companyId: call.company_id })
  const { data: tech } = await admin.from('techs').select('phone, name').eq('id', call.tech_id).maybeSingle()
  const phone = (tech as { phone?: string } | null)?.phone
  if (!phone) return NextResponse.json({ error: 'That call has no number to go on.' }, { status: 409 })

  const { data: existingCompany } = await admin.from('companies').select('id, name').eq('phone', phone).maybeSingle()
  let companyId = (existingCompany as { id: string } | null)?.id
  let companyName = (existingCompany as { name: string } | null)?.name ?? null
  if (!companyId) {
    const { data: created, error } = await admin
      .from('companies')
      .insert({ name: formatPhone(phone), phone, owner_id: user.id, city: null, state: null, timezone: null, next_follow_up: null, do_not_call: false, notes: 'Added from a hand-dialed call.' })
      .select('id, name')
      .single()
    if (error || !created) return NextResponse.json({ error: error?.message ?? 'Could not create the company.' }, { status: 500 })
    companyId = created.id
    companyName = created.name
  }
  await admin.from('calls').update({ company_id: companyId, tech_id: null }).eq('id', id)
  return NextResponse.json({ ok: true, companyId, name: companyName })
}
