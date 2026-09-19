'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { toE164 } from '@/lib/utils'
import { parseCsv, normalizeHeader } from '@/lib/csv'

const text = (max: number) => z.string().trim().max(max).nullable().optional()
const patchSchema = z.object({
  name: text(120),
  phone: text(40),
  email: z.string().trim().email().max(200).nullable().optional(),
  city: text(100),
  state: text(2),
  title: text(120),
  employer: text(160),
  experience: text(4000),
  source: text(100),
  status: z.enum(['new', 'reviewing', 'contacting', 'screened', 'interviewing', 'presented', 'placed', 'rejected']).optional(),
  years_hvac: z.number().min(0).max(60).nullable().optional(),
  epa_cert: z.enum(['none', 'type1', 'type2', 'type3', 'universal']).nullable().optional(),
  role_pref: z.enum(['install', 'service', 'both']).nullable().optional(),
  own_tools: z.boolean().nullable().optional(),
  drivers_license: z.boolean().nullable().optional(),
  commission_ok: z.boolean().nullable().optional(),
  pay_min: z.number().int().min(0).max(500).nullable().optional(),
  available_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  max_commute_miles: z.number().int().min(0).max(300).nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  interview_at: z.string().datetime({ offset: true }).nullable().optional(),
  interview_notes: z.string().trim().max(10_000).nullable().optional(),
  next_follow_up: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  applied_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  placed_company_id: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(10_000).optional(),
  owner_id: z.string().uuid().nullable().optional(),
})

async function me() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}

function normalize(values: z.infer<typeof patchSchema>) {
  const out: Record<string, unknown> = { ...values }
  if ('phone' in values) {
    const raw = values.phone?.trim()
    if (raw) {
      const e164 = toE164(raw)
      if (!e164) return { error: `"${raw}" is not a dialable number.` }
      out.phone = e164
    } else {
      out.phone = null
    }
  }
  if (values.state) out.state = values.state.toUpperCase()
  return { values: out }
}

export async function createTech(input: unknown) {
  const parsed = patchSchema.safeParse(input)
  if (!parsed.success) return { error: 'Invalid value.' }
  const { supabase, user } = await me()
  if (!user) return { error: 'Not signed in.' }
  const n = normalize(parsed.data)
  if ('error' in n) return { error: n.error ?? 'Invalid value.' }
  const { data, error } = await supabase.from('techs').insert({ ...n.values, owner_id: user.id } as never).select('id').single()
  if (error) return { error: error.code === '23505' ? 'A tech with that phone number already exists.' : error.message }
  revalidatePath('/techs')
  return { error: null, id: data?.id as string }
}

export async function updateTech(id: string, patch: unknown) {
  const parsed = patchSchema.safeParse(patch)
  if (!parsed.success) return { error: 'Invalid value.' }
  const { user, supabase } = await me()
  if (!user) return { error: 'Not signed in.' }
  const n = normalize(parsed.data)
  if ('error' in n) return { error: n.error ?? 'Invalid value.' }
  const { error } = await supabase.from('techs').update(n.values as never).eq('id', id)
  if (error) return { error: error.code === '23505' ? 'Another tech already has that phone number.' : error.message }
  revalidatePath('/techs')
  revalidatePath(`/techs/${id}`)
  revalidatePath('/tech-interviews')
  return { error: null }
}

export async function deleteTech(id: string) {
  const { user, supabase } = await me()
  if (!user) return { error: 'Not signed in.' }
  const { error } = await supabase.from('techs').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/techs')
  return { error: null }
}

/**
 * CSV import: name, phone, email, city, state, title, employer, experience,
 * source, notes, applied. Rows whose phone already exists are skipped.
 */
export async function importTechs(csvText: string) {
  const { user, supabase } = await me()
  if (!user) return { inserted: 0, skipped: 0, errors: ['Not signed in.'] }
  const rows = parseCsv(csvText)
  if (rows.length < 2) return { inserted: 0, skipped: 0, errors: ['Need a header row and at least one tech.'] }
  const extra: Record<string, string> = { title: 'title', role: 'title', jobtitle: 'title', employer: 'employer', company: 'employer', experience: 'experience', applied: 'applied_at', applieddate: 'applied_at', status: 'status', fullname: 'name', firstname: 'name' }
  const keys = rows[0].map((h) => {
    const k = h.toLowerCase().replace(/[^a-z]/g, '')
    return extra[k] ?? normalizeHeader(h)
  })
  const errors: string[] = []
  let inserted = 0
  let skipped = 0
  for (const [i, cells] of rows.slice(1).entries()) {
    const rec: Record<string, string> = {}
    keys.forEach((k, j) => {
      if (k && cells[j]?.trim()) rec[k] = cells[j].trim()
    })
    if (!rec.name && !rec.phone) {
      skipped++
      continue
    }
    const phone = rec.phone ? toE164(rec.phone) : null
    if (rec.phone && !phone) {
      errors.push(`Line ${i + 2}: "${rec.phone}" is not a dialable number; imported without a phone`)
    }
    const { error } = await supabase.from('techs').insert({
      name: rec.name ?? null,
      phone,
      email: rec.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email) ? rec.email.toLowerCase() : null,
      city: rec.city ?? null,
      state: rec.state?.toUpperCase().slice(0, 2) ?? null,
      title: rec.title ?? null,
      employer: rec.employer ?? null,
      experience: rec.experience ?? null,
      source: rec.source ?? null,
      applied_at: rec.applied_at && /^\d{4}-\d{2}-\d{2}$/.test(rec.applied_at) ? rec.applied_at : null,
      notes: rec.notes ?? '',
      owner_id: user.id,
    } as never)
    if (error) {
      skipped++
      if (error.code !== '23505') errors.push(`Line ${i + 2}: ${error.message}`)
    } else inserted++
  }
  revalidatePath('/techs')
  return { inserted, skipped, errors }
}

const touchSchema = z.object({
  at: z.string().datetime({ offset: true }).optional(),
  channel: z.enum(['call', 'email', 'text', 'meeting', 'other']),
  summary: z.string().trim().min(1).max(4000),
  next_touch: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

/** Log a touch point; the database schedules the next one a week out unless a date is given. */
export async function addTechTouch(techId: string, input: unknown) {
  const parsed = touchSchema.safeParse(input)
  if (!parsed.success) return { error: 'Write a line about what happened.' }
  const { user, supabase } = await me()
  if (!user) return { error: 'Not signed in.' }
  const { error } = await supabase.from('tech_touchpoints').insert({ tech_id: techId, user_id: user.id, ...parsed.data } as never)
  if (error) return { error: error.message }
  // A first real conversation moves a fresh applicant along.
  await supabase.from('techs').update({ status: 'contacting' } as never).eq('id', techId).in('status', ['new', 'reviewing'])
  revalidatePath(`/techs/${techId}`)
  revalidatePath('/techs')
  return { error: null }
}

export async function deleteTechTouch(id: string, techId: string) {
  const { user, supabase } = await me()
  if (!user) return { error: 'Not signed in.' }
  const { error } = await supabase.from('tech_touchpoints').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/techs/${techId}`)
  return { error: null }
}

/** Put a tech forward to a client. Moves the tech to "presented". */
export async function presentTech(techId: string, clientId: string, score: number | null) {
  const { user, supabase } = await me()
  if (!user) return { error: 'Not signed in.' }
  const { error } = await supabase
    .from('tech_presentations')
    .upsert({ tech_id: techId, client_id: clientId, status: 'presented', match_score: score, created_by: user.id } as never, { onConflict: 'tech_id,client_id' })
  if (error) return { error: error.message }
  await supabase.from('techs').update({ status: 'presented' } as never).eq('id', techId).in('status', ['new', 'reviewing', 'contacting', 'screened', 'interviewing'])
  revalidatePath(`/techs/${techId}`)
  revalidatePath('/techs')
  return { error: null }
}

export async function setPresentationStatus(id: string, techId: string, status: 'proposed' | 'presented' | 'interviewing' | 'hired' | 'declined') {
  const { user, supabase } = await me()
  if (!user) return { error: 'Not signed in.' }
  const { data, error } = await supabase.from('tech_presentations').update({ status } as never).eq('id', id).select('client_id').single()
  if (error) return { error: error.message }
  if (status === 'hired' && data) {
    const { data: client } = await supabase.from('clients').select('company_id').eq('id', (data as { client_id: string }).client_id).single()
    await supabase.from('techs').update({ status: 'placed', placed_company_id: (client as { company_id: string } | null)?.company_id ?? null } as never).eq('id', techId)
  }
  revalidatePath(`/techs/${techId}`)
  revalidatePath('/techs')
  return { error: null }
}

const referralSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(7).max(40),
  /** The tech who gave the referral, if the call was to a tech. */
  fromTechId: z.string().uuid().nullable().optional(),
  /** The company we were speaking to, if the call was to a shop. */
  fromCompanyId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(500).optional(),
})

/**
 * Take a referral mid-call: a name and a number become a tech in the queue,
 * with a trail back to whoever named them. Idempotent on the phone number, so
 * a referral we already know updates rather than duplicates.
 */
export async function addReferral(input: unknown) {
  const parsed = referralSchema.safeParse(input)
  if (!parsed.success) return { error: 'A name and a phone number are needed.' }
  const { user, supabase } = await me()
  if (!user) return { error: 'Not signed in.' }
  const { name, phone, fromTechId, fromCompanyId, note } = parsed.data

  const e164 = toE164(phone)
  if (!e164) return { error: `"${phone}" is not a dialable number.` }

  let referredBy: string | null = null
  if (fromTechId) {
    const { data } = await supabase.from('techs').select('name').eq('id', fromTechId).maybeSingle()
    referredBy = (data as { name?: string | null } | null)?.name ?? null
  } else if (fromCompanyId) {
    const { data } = await supabase.from('companies').select('name').eq('id', fromCompanyId).maybeSingle()
    referredBy = (data as { name?: string | null } | null)?.name ?? null
  }

  const { data: existing } = await supabase.from('techs').select('id, name').eq('phone', e164).maybeSingle()
  if (existing) {
    const known = existing as { id: string; name: string | null }
    await supabase
      .from('techs')
      .update({ name: known.name ?? name, referred_by_tech_id: fromTechId ?? null, referred_by: referredBy } as never)
      .eq('id', known.id)
    revalidatePath('/techs')
    return { error: null, id: known.id, existed: true }
  }

  const { data, error } = await supabase
    .from('techs')
    .insert({
      name,
      phone: e164,
      source: referredBy ? `Referral from ${referredBy}` : 'Referral',
      status: 'new',
      owner_id: user.id,
      referred_by_tech_id: fromTechId ?? null,
      referred_by: referredBy,
      notes: [note, referredBy ? `Referred by ${referredBy}.` : 'Referred during a call.'].filter(Boolean).join(' '),
    } as never)
    .select('id')
    .single()
  if (error) return { error: error.message }

  // The referrer's own record should show that they gave us someone.
  if (fromTechId) {
    await supabase.from('tech_touchpoints').insert({
      tech_id: fromTechId,
      user_id: user.id,
      channel: 'call',
      summary: `Referred ${name} (${e164})`,
    } as never)
  }

  revalidatePath('/techs')
  return { error: null, id: (data as { id: string }).id, existed: false }
}
