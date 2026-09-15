import type { SupabaseClient } from '@supabase/supabase-js'
import { formatPhone, timezoneForState, toE164 } from '@/lib/utils'
import { isPlaceholderName, nameKey, tidyName } from '@/lib/leads/dedupe'

export type LeadInput = {
  name?: string | null
  city?: string | null
  state?: string | null
  phone?: string | null
  source?: string | null
  email?: string | null
  notes?: string | null
}

export type LeadImportResult = {
  /** New companies added to Leads. */
  inserted: number
  /** Rows that matched a company already in Leads and filled in its blanks. */
  updated: number
  /** Rows folded into another row in the same file (same phone or same business). */
  mergedInFile: number
  /** Rows already in Leads with nothing new to add. */
  unchanged: number
  skipped: number
  errors: string[]
}

type Existing = {
  id: string
  name: string
  phone: string | null
  city: string | null
  state: string | null
  source: string | null
  email: string | null
}

type Group = {
  name: string
  key: string
  phones: string[]
  city: string | null
  state: string | null
  source: string | null
  email: string | null
  notes: string
}

const clean = (v: string | null | undefined) => {
  const t = (v ?? '').toString().trim().replace(/\s+/g, ' ')
  return t === '' ? null : t
}

const validEmail = (v: string | null | undefined) => {
  const t = clean(v)?.toLowerCase() ?? null
  return t && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null
}

const titleCity = (city: string | null) =>
  city && !/[a-z]/.test(city) ? city.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : city

/**
 * Add companies to Leads without ever creating a duplicate business or number.
 *
 * 1. Rows in the file that share a phone number or a business name (see
 *    nameKey) collapse into one lead; extra numbers are kept in its notes.
 * 2. Each lead is matched against Leads by phone first, then by name. A match
 *    only fills in fields that are blank; nothing a rep entered is overwritten,
 *    except a placeholder name like "(602) 555-0100" left by the manual dialer.
 * 3. Everything else is inserted. The unique indexes on phone and name_key are
 *    the backstop if two imports race.
 */
export async function importLeads(
  supabase: SupabaseClient,
  rows: LeadInput[],
  options: { ownerId: string | null; defaultState?: string | null; firstLine?: number },
): Promise<LeadImportResult> {
  const result: LeadImportResult = { inserted: 0, updated: 0, mergedInFile: 0, unchanged: 0, skipped: 0, errors: [] }
  const firstLine = options.firstLine ?? 2
  const defaultState = clean(options.defaultState)?.toUpperCase().slice(0, 2) ?? null

  // --- 1. collapse the file onto itself --------------------------------------
  const groups: Group[] = []
  const byPhone = new Map<string, Group>()
  const byKey = new Map<string, Group>()

  rows.forEach((row, index) => {
    const line = firstLine + index
    const rawName = clean(row.name)
    const rawPhone = clean(row.phone)

    if (!rawName) {
      // Registry exports (Orbis) put extra contacts on name-less follow-on rows.
      if (rawPhone) {
        result.skipped++
        result.errors.push(`Line ${line}: phone ${rawPhone} has no company name`)
      }
      return
    }

    const phone = toE164(rawPhone)
    if (rawPhone && !phone) {
      result.errors.push(`Line ${line}: "${rawPhone}" is not a dialable number; imported without a phone`)
    }

    const name = tidyName(rawName)
    const key = nameKey(name)
    const state = clean(row.state)?.toUpperCase().slice(0, 2) ?? defaultState
    const match = (phone && byPhone.get(phone)) || byKey.get(key)

    if (match) {
      result.mergedInFile++
      if (phone && !match.phones.includes(phone)) {
        match.phones.push(phone)
        byPhone.set(phone, match)
      }
      match.city ??= titleCity(clean(row.city))
      match.state ??= state
      match.source ??= clean(row.source)
      match.email ??= validEmail(row.email)
      if (!byKey.has(key)) byKey.set(key, match)
      return
    }

    const group: Group = {
      name,
      key,
      phones: phone ? [phone] : [],
      city: titleCity(clean(row.city)),
      state,
      source: clean(row.source),
      email: validEmail(row.email),
      notes: clean(row.notes) ?? '',
    }
    groups.push(group)
    byKey.set(key, group)
    if (phone) byPhone.set(phone, group)
  })

  if (groups.length === 0) return result

  // --- 2. load what's already in Leads ----------------------------------------
  const existing: Existing[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, phone, city, state, source, email')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`Could not read existing leads: ${error.message}`)
    existing.push(...(data as Existing[]))
    if (!data || data.length < 1000) break
  }

  const existingByPhone = new Map<string, Existing>()
  const existingByKey = new Map<string, Existing>()
  for (const company of existing) {
    if (company.phone) existingByPhone.set(company.phone, company)
    existingByKey.set(nameKey(company.name), company)
  }

  // --- 3. update matches, collect inserts -------------------------------------
  const inserts: Record<string, unknown>[] = []

  for (const group of groups) {
    const match =
      group.phones.map((p) => existingByPhone.get(p)).find(Boolean) ?? existingByKey.get(group.key)

    if (!match) {
      const [phone, ...others] = group.phones
      inserts.push({
        name: group.name,
        phone: phone ?? null,
        city: group.city,
        state: group.state,
        timezone: timezoneForState(group.state),
        source: group.source,
        email: group.email,
        notes: [group.notes, others.length ? `Other numbers: ${others.map(formatPhone).join(', ')}` : '']
          .filter(Boolean)
          .join('\n'),
        owner_id: options.ownerId,
      })
      continue
    }

    const patch: Record<string, unknown> = {}
    if (!match.phone) {
      const free = group.phones.find((p) => !existingByPhone.has(p))
      if (free) patch.phone = free
    }
    if (isPlaceholderName(match.name) && group.key !== nameKey(match.name) && !existingByKey.has(group.key)) {
      patch.name = group.name
    }
    if (!match.city && group.city) patch.city = group.city
    if (!match.state && group.state) {
      patch.state = group.state
      patch.timezone = timezoneForState(group.state)
    }
    if (!match.source && group.source) patch.source = group.source
    if (!match.email && group.email) patch.email = group.email

    if (Object.keys(patch).length === 0) {
      result.unchanged++
      continue
    }

    const { error } = await supabase.from('companies').update(patch).eq('id', match.id)
    if (error) {
      result.skipped++
      result.errors.push(`${group.name}: ${error.message}`)
    } else {
      result.updated++
      if (patch.phone) existingByPhone.set(patch.phone as string, match)
      if (patch.name) existingByKey.set(group.key, match)
    }
  }

  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500)
    const { error } = await supabase.from('companies').insert(chunk as never)
    if (!error) {
      result.inserted += chunk.length
      continue
    }
    // A chunk fails as a whole; retry row by row so one conflict (for example a
    // teammate importing the same list at the same moment) doesn't drop 499 others.
    for (const row of chunk) {
      const { error: rowError } = await supabase.from('companies').insert(row as never)
      if (rowError) {
        result.skipped++
        result.errors.push(
          `${row.name}: ${rowError.code === '23505' ? 'already in Leads' : rowError.message}`,
        )
      } else {
        result.inserted++
      }
    }
  }

  return result
}
