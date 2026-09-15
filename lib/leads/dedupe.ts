/**
 * Dedupe rules for leads. `nameKey` must stay identical to the SQL
 * `company_name_key` function in supabase/migrations/0012_leads_crm_dedupe.sql,
 * which backs the unique index on companies.name_key.
 */

const LEGAL_SUFFIXES = /( (llc|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|pc|dba))+ $/

export function nameKey(name: string | null | undefined): string {
  const lowered = (name ?? '').toLowerCase()
  const words = ' ' + lowered.replace(/[.'’]/g, '').replaceAll('&', ' and ').replace(/[^a-z0-9]+/g, ' ').trim() + ' '
  const key = words.replace(/^ the /, ' ').replace(LEGAL_SUFFIXES, ' ').replaceAll(' ', '')
  return key || lowered.replace(/[^a-z0-9]+/g, '')
}

/** Names the manual dialer invents for an unknown number, e.g. "(602) 555-0100". */
export function isPlaceholderName(name: string | null | undefined): boolean {
  return /^\(\d{3}\) \d{3}-\d{4}$/.test((name ?? '').trim())
}

const SMALL_WORDS = new Set(['AND', 'OF', 'THE', 'FOR', 'IN', 'AT', 'ON', 'BY'])
const KEEP_UPPER = new Set(['LLC', 'LLP', 'LP', 'PLLC', 'HVAC', 'HVACR', 'AC', 'A/C', 'AZ', 'USA', 'US', 'II', 'III', 'IV', 'DBA', 'PC', 'MEP', 'RV'])

/**
 * Registry exports shout ("PARKER & SONS, INC."). Title-case those for display;
 * names that already have lowercase letters are left exactly as typed.
 */
export function tidyName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (/[a-z]/.test(trimmed)) return trimmed
  let first = true
  return trimmed.replace(/[A-Z0-9/]+(?:'[A-Z]+)?/g, (word) => {
    const isFirst = first
    first = false
    if (KEEP_UPPER.has(word)) return word
    if (!isFirst && SMALL_WORDS.has(word)) return word.toLowerCase()
    if (/\d/.test(word) && !/^\d+(ST|ND|RD|TH)$/.test(word)) return word
    return word.charAt(0) + word.slice(1).toLowerCase()
  })
}
