// Usage: set -a; . ./.env.local; set +a; npx tsx --tsconfig tsconfig.json scripts/import-leads.mts leads.csv
// Imports a CSV into Leads with the same dedupe rules as the Leads → Import button,
// using the service key so it needs no browser session.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { parseCsv, normalizeHeader } from '@/lib/csv'
import { importLeads, type LeadInput } from '@/lib/leads/import'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SECRET_KEY!
const supabase = createClient(url, key, { auth: { persistSession: false } })

const table = parseCsv(readFileSync(process.argv[2], 'utf8'))
const keys = table[0].map(normalizeHeader)
const rows: LeadInput[] = table.slice(1).map((cells) => {
  const lead: Record<string, string> = {}
  keys.forEach((k, i) => {
    const v = cells[i]
    if (k && v != null && String(v).trim() !== '' && !lead[k]) lead[k] = String(v)
  })
  return lead as LeadInput
})
console.log('rows parsed:', rows.length)

const result = await importLeads(supabase, rows, { ownerId: null, defaultState: 'AZ', firstLine: 2 })
const { errors, ...summary } = result
console.log(JSON.stringify(summary))
console.log('errors:', errors.length)
for (const e of errors.slice(0, 15)) console.log(' ', e)
