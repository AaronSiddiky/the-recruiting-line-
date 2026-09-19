'use client'

import { useState, useTransition } from 'react'
import { UserPlus } from 'lucide-react'
import { addReferral } from '@/lib/actions/techs'
import { formatPhone } from '@/lib/utils'

/**
 * "Know anyone else looking?" — taken during the call, since nobody goes back
 * for it afterwards. Each name saved becomes a tech in the dial queue.
 */
export function ReferralCapture({ fromTechId, fromCompanyId }: { fromTechId?: string | null; fromCompanyId?: string | null }) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [added, setAdded] = useState<{ name: string; phone: string; existed: boolean }[]>([])
  const [error, setError] = useState<string | null>(null)

  function add() {
    if (!name.trim() || !phone.trim()) return
    startTransition(async () => {
      const res = await addReferral({ name: name.trim(), phone: phone.trim(), fromTechId: fromTechId ?? null, fromCompanyId: fromCompanyId ?? null })
      if (res.error) {
        setError(res.error)
        return
      }
      setError(null)
      setAdded((a) => [...a, { name: name.trim(), phone: phone.trim(), existed: !!res.existed }])
      setName('')
      setPhone('')
    })
  }

  const field = 'h-8 min-w-0 rounded-md border border-border-strong bg-background px-2 text-sm focus:outline-2 focus:outline-accent'

  return (
    <fieldset className="rounded-md border border-border-subtle p-3">
      <legend className="inline-flex items-center gap-1.5 px-1 text-xs font-medium text-muted">
        <UserPlus className="size-3" aria-hidden />
        Know anyone else looking?
      </legend>
      <div className="grid grid-cols-[1fr_140px_auto] gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" aria-label="Referral name" className={field} />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="(602) 555-0100"
          inputMode="tel"
          aria-label="Referral phone"
          className={`${field} tnum`}
        />
        <button
          type="button"
          onClick={add}
          disabled={pending || !name.trim() || !phone.trim()}
          className="h-8 cursor-pointer rounded-md border border-border-strong px-3 text-sm font-medium hover:bg-surface-2 disabled:opacity-40"
        >
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>
      {added.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-good">
          {added.map((a, i) => (
            <li key={`${a.phone}:${i}`}>
              ✓ {a.name} · {formatPhone(a.phone.startsWith('+') ? a.phone : `+1${a.phone.replace(/\D/g, '')}`)} {a.existed ? 'was already in Techs' : 'added to Techs'}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1.5 text-xs text-bad">{error}</p>}
    </fieldset>
  )
}
