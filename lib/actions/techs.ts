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
  status: z.enum(['new', 'reviewing', 'contacting', 'interviewing', 'placed', 'rejected']).optional(),
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
