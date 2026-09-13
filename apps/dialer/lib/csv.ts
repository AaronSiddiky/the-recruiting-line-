/**
 * Minimal RFC-4180 CSV reader. Enough for pasted lead lists: quoted fields,
 * escaped quotes, CRLF. Deliberately not a dependency -- lead files are the
 * one input we can re-import if it gets something wrong.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const src = text.replace(/^﻿/, '') // strip BOM from Excel exports

  for (let i = 0; i < src.length; i++) {
    const char = src[i]

    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += char
    }
  }

  row.push(field)
  if (row.some((c) => c.trim() !== '')) rows.push(row)

  return rows
}

/** Map loose header names onto our columns. Case- and space-insensitive. */
const HEADER_ALIASES: Record<string, string> = {
  company: 'name',
  companyname: 'name',
  name: 'name',
  account: 'name',
  city: 'city',
  state: 'state',
  st: 'state',
  phone: 'phone',
  phonenumber: 'phone',
  number: 'phone',
  tel: 'phone',
  telephone: 'phone',
  notes: 'notes',
  source: 'source',
  leadsource: 'source',
  channel: 'source',
  note: 'notes',
}

export function normalizeHeader(header: string): string | null {
  const key = header.toLowerCase().replace(/[^a-z]/g, '')
  return HEADER_ALIASES[key] ?? null
}
