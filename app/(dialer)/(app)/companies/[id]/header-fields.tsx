'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateCompany } from '@/lib/actions/companies'
import type { CompanyRow, Profile } from '@/types/db'

export function CompanyHeaderFields({
  company,
  profiles,
}: {
  company: CompanyRow
  profiles: Pick<Profile, 'id' | 'full_name'>[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [notes, setNotes] = useState(company.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  function save(patch: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateCompany(company.id, patch)
      setError(res.error)
      if (res.error) router.refresh()
    })
  }

  const fieldClass =
    'h-8 w-full rounded-md border border-border-strong bg-background px-2 text-sm focus:outline-2 focus:outline-accent'

  return (
    <section className="mt-5 grid gap-4 sm:grid-cols-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">Owner</span>
        <select
          defaultValue={company.owner_id ?? ''}
          onChange={(e) => save({ owner_id: e.target.value || null })}
          className={fieldClass}
        >
          <option value="">Unassigned</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">Next follow-up</span>
        <input
          type="date"
          defaultValue={company.next_follow_up ?? ''}
          onChange={(e) => save({ next_follow_up: e.target.value || null })}
          className={`${fieldClass} tnum`}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">Email</span>
        <input
          type="email"
          defaultValue={company.email ?? ''}
          placeholder="owner@company.com"
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v !== (company.email ?? '')) save({ email: v || null })
          }}
          className={fieldClass}
        />
      </label>

      <label className="flex cursor-pointer flex-col gap-1">
        <span className="text-xs font-medium text-muted">Dialable</span>
        <span className="flex h-8 items-center gap-2 rounded-md border border-border-strong px-2 text-sm">
          <input
            type="checkbox"
            defaultChecked={company.do_not_call}
            onChange={(e) => save({ do_not_call: e.target.checked })}
            className="size-3.5 accent-[var(--bad)]"
          />
          Do not call
        </span>
      </label>

      <label className="flex flex-col gap-1 sm:col-span-3">
        <span className="text-xs font-medium text-muted">
          Company notes
          <span className="ml-1.5 font-normal text-muted-2">
            standing context, not per-call notes
          </span>
        </span>
        <textarea
          value={notes}
          rows={3}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (company.notes ?? '') && save({ notes })}
          className="w-full resize-y rounded-md border border-border-strong bg-background p-2 text-sm focus:outline-2 focus:outline-accent"
        />
      </label>

      {error && (
        <p role="alert" className="text-xs text-bad sm:col-span-3">
          Could not save: {error}
        </p>
      )}
    </section>
  )
}
