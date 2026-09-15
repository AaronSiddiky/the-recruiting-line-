'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { importLeads, type LeadImportResult } from '@/lib/leads/import'

const field = z.string().max(500).nullable().optional()
const inputSchema = z.object({
  rows: z
    .array(z.object({ name: field, city: field, state: field, phone: field, source: field, email: field, notes: z.string().max(10_000).nullable().optional() }))
    .max(50_000),
  defaultState: z.string().max(2).nullable().optional(),
  firstLine: z.number().int().min(1).optional(),
})

export type ImportLeadsResponse = LeadImportResult & { error?: string }

/** Import parsed spreadsheet rows into Leads. Parsing happens in the browser. */
export async function importLeadRows(input: unknown): Promise<ImportLeadsResponse> {
  const empty = { inserted: 0, updated: 0, mergedInFile: 0, unchanged: 0, skipped: 0, errors: [] }

  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { ...empty, error: 'That file could not be read.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ...empty, error: 'Not signed in.' }

  try {
    const result = await importLeads(supabase, parsed.data.rows, {
      ownerId: user.id,
      defaultState: parsed.data.defaultState,
      firstLine: parsed.data.firstLine,
    })
    revalidatePath('/leads')
    revalidatePath('/crm')
    revalidatePath('/dialer')
    return result
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : 'Import failed.' }
  }
}
