'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { timezoneForState } from '@/lib/utils'
import type { Company } from '@/types/db'

const patchSchema = z.object({
  notes: z.string().max(10_000).optional(),
  next_follow_up: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  do_not_call: z.boolean().optional(),
  name: z.string().min(1).max(200).optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().length(2).nullable().optional(),
  source: z.string().trim().max(100).nullable().optional(),
  reached_out: z.boolean().optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
})

/**
 * Inline edits from the CRM grid. Runs under the user's own session, so RLS
 * decides whether they may touch this row -- we never widen that here.
 */
export async function updateCompany(id: string, patch: unknown) {
  const parsed = patchSchema.safeParse(patch)
  if (!parsed.success) {
    return { error: 'Invalid value.' }
  }

  const supabase = await createClient()
  const values: Partial<Company> = { ...parsed.data }

  if (values.state) {
    values.state = values.state.toUpperCase()
    values.timezone = timezoneForState(values.state)
  }

  const { error } = await supabase.from('companies').update(values).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/crm')
  revalidatePath('/leads')
  revalidatePath(`/companies/${id}`)
  return { error: null }
}

/**
 * Remove a company and, by cascade, its calls. RLS decides who may; a refused
 * delete removes zero rows rather than erroring, so we check the count and
 * say so instead of pretending it worked.
 */
export async function deleteCompany(id: string) {
  if (!z.string().uuid().safeParse(id).success) return { error: 'Invalid company.' }

  const supabase = await createClient()
  const { data, error } = await supabase.from('companies').delete().eq('id', id).select('id')
  if (error) return { error: error.message }
  if (!data?.length) {
    return { error: 'Not allowed to delete this company. Run migration 0008 if deletes should be open to every rep.' }
  }

  revalidatePath('/crm')
  revalidatePath('/leads')
  return { error: null }
}
