'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const text = (max: number) => z.string().trim().max(max)

const patchSchema = z.object({
  won_by: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'paused', 'ended']).optional(),
  contact_name: text(120).nullable().optional(),
  contact_title: text(120).nullable().optional(),
  contact_email: z.string().trim().email().max(200).nullable().optional(),
  contact_phone: text(40).nullable().optional(),
  signed_at: date.nullable().optional(),
  fee_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  fee_note: text(300).nullable().optional(),
  guarantee_days: z.number().int().min(0).max(3650).nullable().optional(),
  payment_terms: text(500).nullable().optional(),
  role_brief: text(2000).nullable().optional(),
  notes: text(10_000).optional(),
})

async function user() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { supabase, user }
}

/** Turn a company into a client and open its page. Idempotent per company. */
export async function makeClient(companyId: string) {
  if (!z.string().uuid().safeParse(companyId).success) return { error: 'Invalid company.' }
  const { supabase, user: me } = await user()
  if (!me) return { error: 'Not signed in.' }

  const { data: existing } = await supabase.from('clients').select('id').eq('company_id', companyId).maybeSingle()
  let id = existing?.id
  if (!id) {
    const { data, error } = await supabase
      .from('clients')
      .insert({ company_id: companyId, won_by: me.id })
      .select('id')
      .single()
    if (error || !data) return { error: error?.message ?? 'Could not create the client.' }
    id = data.id
    // A signed client is, by definition, a contacted company.
    await supabase.from('companies').update({ reached_out: true }).eq('id', companyId)
  }
  revalidatePath('/clients')
  revalidatePath(`/companies/${companyId}`)
  redirect(`/clients/${id}`)
}

export async function updateClient(id: string, patch: unknown) {
  const parsed = patchSchema.safeParse(patch)
  if (!parsed.success) return { error: 'Invalid value.' }
  const { supabase, user: me } = await user()
  if (!me) return { error: 'Not signed in.' }

  const { error } = await supabase.from('clients').update(parsed.data).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/clients')
  revalidatePath(`/clients/${id}`)
  revalidatePath('/stats')
  return { error: null }
}

const touchSchema = z.object({
  at: z.string().datetime({ offset: true }).optional(),
  channel: z.enum(['call', 'email', 'text', 'meeting', 'other']),
  summary: text(4000).min(1),
  next_follow_up: date.nullable().optional(),
})

export async function addTouchpoint(clientId: string, input: unknown) {
  const parsed = touchSchema.safeParse(input)
  if (!parsed.success) return { error: 'Write a line about what happened.' }
  const { supabase, user: me } = await user()
  if (!me) return { error: 'Not signed in.' }

  const { error } = await supabase
    .from('client_touchpoints')
    .insert({ client_id: clientId, user_id: me.id, ...parsed.data })
  if (error) return { error: error.message }
  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)
  return { error: null }
}

export async function deleteTouchpoint(id: string, clientId: string) {
  const { supabase, user: me } = await user()
  if (!me) return { error: 'Not signed in.' }
  const { error } = await supabase.from('client_touchpoints').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)
  return { error: null }
}

export async function deleteClient(id: string) {
  const { supabase, user: me } = await user()
  if (!me) return { error: 'Not signed in.' }
  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/clients')
  revalidatePath('/stats')
  redirect('/clients')
}
