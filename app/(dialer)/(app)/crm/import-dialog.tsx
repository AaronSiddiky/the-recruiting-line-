'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { importCompanies, type ImportResult } from './actions'

const SAMPLE = `company,city,state,phone
Acme Staffing,Austin,TX,(512) 555-0101
Borealis Health,Denver,CO,303-555-0102`

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [result, setResult] = useState<(ImportResult & { error?: string }) | null>(null)
  const [pending, startTransition] = useTransition()

  async function onFile(file: File | undefined) {
    if (!file) return
    setText(await file.text())
    setResult(null)
  }

  function submit() {
    startTransition(async () => {
      const res = await importCompanies(text)
      setResult(res)
      if (!res.error && res.inserted > 0) router.refresh()
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import companies from CSV"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-lg border border-border-subtle bg-background shadow-lg">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold">Import companies</h2>
          <button onClick={onClose} aria-label="Close" className="cursor-pointer text-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <p className="text-xs text-muted">
            Needs a company name column and a phone column; city, state, source and notes
            are optional. Rows are matched on phone number, so re-importing a
            list updates the existing companies instead of duplicating them.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="text-xs file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border-strong file:bg-background file:px-2 file:py-1 file:text-xs"
          />

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={SAMPLE}
            spellCheck={false}
            rows={8}
            aria-label="CSV contents"
            className="w-full resize-y rounded-md border border-border-strong p-2 font-mono text-xs focus:outline-2 focus:outline-accent"
          />

          {result && (
            <div className="rounded-md border border-border-subtle bg-surface p-2.5 text-xs">
              {result.error ? (
                <p className="text-bad">{result.error}</p>
              ) : (
                <p className="text-good">
                  Imported {result.inserted}{' '}
                  {result.inserted === 1 ? 'company' : 'companies'}
                  {result.existing > 0 && `, ${result.existing} already in the CRM (left unchanged)`}
                  {result.skipped > 0 && `, skipped ${result.skipped}`}.
                </p>
              )}
              {result.errors.length > 0 && (
                <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto text-muted">
                  {result.errors.slice(0, 25).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                  {result.errors.length > 25 && (
                    <li>…and {result.errors.length - 25} more</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-subtle px-4 py-3">
          <Button onClick={onClose}>
            {result && !result.error ? 'Done' : 'Cancel'}
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending || !text.trim()}>
            {pending ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </div>
    </div>
  )
}
