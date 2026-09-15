'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseCsv, normalizeHeader } from '@/lib/csv'
import type { LeadInput } from '@/lib/leads/import'
import { importLeadRows, type ImportLeadsResponse } from './actions'

type Parsed = { rows: LeadInput[]; firstLine: number; label: string }

/** Find the header row (registry exports put a title block above it) and map columns. */
function toLeads(table: unknown[][], label: string): Parsed | string {
  const headerIndex = table
    .slice(0, 15)
    .findIndex((row) => row.map((c) => normalizeHeader(String(c ?? ''))).includes('name'))
  if (headerIndex === -1) return 'Could not find a company name column.'

  const keys = table[headerIndex].map((c) => normalizeHeader(String(c ?? '')))
  const rows = table.slice(headerIndex + 1).map((cells) => {
    const lead: Record<string, string> = {}
    keys.forEach((key, i) => {
      const cell = cells[i]
      if (key && cell != null && String(cell).trim() !== '' && !lead[key]) lead[key] = String(cell)
    })
    return lead as LeadInput
  })
  return { rows, firstLine: headerIndex + 2, label }
}

async function readFile(file: File): Promise<Parsed | string> {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    const sheets = await readXlsxFile(file)
    for (const { sheet, data } of sheets) {
      const parsed = toLeads(data, `${file.name} — ${sheet}`)
      if (typeof parsed !== 'string') return parsed
    }
    return 'No sheet in that workbook has a company name column.'
  }
  return toLeads(parseCsv(await file.text()), file.name)
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [defaultState, setDefaultState] = useState('')
  const [result, setResult] = useState<ImportLeadsResponse | null>(null)
  const [pending, startTransition] = useTransition()

  async function onFile(file: File | undefined) {
    setParsed(null)
    setResult(null)
    setReadError(null)
    if (!file) return
    try {
      const out = await readFile(file)
      if (typeof out === 'string') setReadError(out)
      else setParsed(out)
    } catch {
      setReadError('That file could not be read. Use .csv or .xlsx.')
    }
  }

  function submit() {
    if (!parsed) return
    startTransition(async () => {
      const res = await importLeadRows({
        rows: parsed.rows,
        firstLine: parsed.firstLine,
        defaultState: defaultState || null,
      })
      setResult(res)
      if (!res.error) router.refresh()
    })
  }

  const companies = parsed?.rows.filter((r) => r.name?.trim()).length ?? 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import leads"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-lg border border-border-subtle bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold">Import leads</h2>
          <button onClick={onClose} aria-label="Close" className="cursor-pointer text-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <p className="text-xs text-muted">
            A .csv or .xlsx (Orbis exports work as-is) with a company name column. Phone, city, state,
            source and email are optional. A company already in Leads, matched by phone number or business
            name, is never added twice; the import only fills in its missing details.
          </p>

          <input
            type="file"
            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="text-xs file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border-strong file:bg-background file:px-2 file:py-1 file:text-xs"
          />

          {readError && <p className="text-xs text-bad">{readError}</p>}

          {parsed && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface p-2.5 text-xs">
              <span className="truncate text-muted" title={parsed.label}>
                <span className="tnum font-medium text-foreground">{companies.toLocaleString()}</span>{' '}
                companies in {parsed.label}
              </span>
              <label className="flex shrink-0 items-center gap-1.5 text-muted">
                State if missing
                <input
                  value={defaultState}
                  onChange={(e) =>
                    setDefaultState(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2))
                  }
                  placeholder="AZ"
                  aria-label="State for rows without one"
                  className="h-6 w-10 rounded border border-border-strong bg-background px-1 text-center uppercase"
                />
              </label>
            </div>
          )}

          {result && (
            <div className="rounded-md border border-border-subtle bg-surface p-2.5 text-xs">
              {result.error ? (
                <p className="text-bad">{result.error}</p>
              ) : (
                <p className="text-good">
                  Added {result.inserted.toLocaleString()} new {result.inserted === 1 ? 'lead' : 'leads'}.
                  {result.updated > 0 && ` Filled in details on ${result.updated.toLocaleString()} existing.`}
                  {result.unchanged > 0 && ` ${result.unchanged.toLocaleString()} were already in Leads.`}
                  {result.mergedInFile > 0 && ` Merged ${result.mergedInFile.toLocaleString()} duplicate rows.`}
                  {result.skipped > 0 && ` Skipped ${result.skipped.toLocaleString()}.`}
                </p>
              )}
              {result.errors.length > 0 && (
                <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto text-muted">
                  {result.errors.slice(0, 25).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                  {result.errors.length > 25 && <li>…and {result.errors.length - 25} more</li>}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <Button onClick={onClose}>{result && !result.error ? 'Done' : 'Cancel'}</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={pending || !parsed || companies === 0 || (!!result && !result.error)}
          >
            {pending ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </div>
    </div>
  )
}
