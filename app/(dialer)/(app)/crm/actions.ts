'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { parseCsv, normalizeHeader } from '@/lib/csv'
import { toE164, timezoneForState } from '@/lib/utils'

export type ImportResult = {
  inserted: number
  /** Rows whose phone already belongs to a company in the CRM. Left untouched. */
  existing: number
  skipped: number
  errors: string[]
}

/**
 * CSV import. Phone is the unique key. A row whose phone is already in the
 * CRM is left alone rather than overwritten: that company may have call
 * history, notes and an outcome, and a fresh list export must not rename it
 * or reset its source. The dialer therefore never gets a duplicate to call.
 */
export async function importCompanies(
  csvText: string,
): Promise<ImportResult & { error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { inserted: 0, existing: 0, skipped: 0, errors: [], error: 'Not signed in.' }

  const rows = parseCsv(csvText)
  if (rows.length < 2) {
    return { inserted: 0, existing: 0, skipped: 0, errors: [], error: 'Need a header row and at least one lead.' }
  }

  const headers = rows[0].map(normalizeHeader)
  if (!headers.includes('name') || !headers.includes('phone')) {
    return {
      inserted: 0,
      existing: 0,
      skipped: 0,
      errors: [],
      error: 'CSV must have a company name column and a phone column.',
    }
  }

  const errors: string[] = []
  const payload: Record<string, unknown>[] = []
  const seen = new Set<string>()

  rows.slice(1).forEach((cells, index) => {
    const record: Record<string, string> = {}
    headers.forEach((key, i) => {
      if (key) record[key] = (cells[i] ?? '').trim()
    })

    const lineNo = index + 2
    const phone = toE164(record.phone)

    if (!record.name) {
      errors.push(`Line ${lineNo}: missing company name`)
      return
    }
    if (!phone) {
      errors.push(`Line ${lineNo}: "${record.phone || 'blank'}" is not a dialable number`)
      return
    }
    if (seen.has(phone)) {
      errors.push(`Line ${lineNo}: duplicate of an earlier row in this file`)
      return
    }
    seen.add(phone)

    const state = record.state ? record.state.toUpperCase().slice(0, 2) : null
    payload.push({
      name: record.name,
      city: record.city || null,
      state,
      phone,
      notes: record.notes || '',
      source: record.source || null,
      email: record.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email) ? record.email : null,
      timezone: timezoneForState(state),
      owner_id: user.id,
    })
  })

  if (payload.length === 0) {
    return { inserted: 0, existing: 0, skipped: errors.length, errors, error: 'No importable rows.' }
  }

  const { error, count } = await supabase
    .from('companies')
    .upsert(payload as never, { onConflict: 'phone', ignoreDuplicates: true, count: 'exact' })
    .select('id')

  if (error) {
    return { inserted: 0, existing: 0, skipped: errors.length, errors, error: error.message }
  }

  const inserted = count ?? 0
  revalidatePath('/crm')
  revalidatePath('/leads')
  return { inserted, existing: payload.length - inserted, skipped: errors.length, errors }
}
