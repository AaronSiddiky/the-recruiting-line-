'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { deleteCompany } from '@/lib/actions/companies'

export function DeleteCompanyButton({
  id,
  name,
  callCount,
}: {
  id: string
  name: string
  callCount: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onClick() {
    const history = callCount
      ? ` Its ${callCount} ${callCount === 1 ? 'call' : 'calls'}, notes and recordings go with it.`
      : ''
    if (!window.confirm(`Delete ${name} from the CRM?${history} This cannot be undone.`)) return
    startTransition(async () => {
      const res = await deleteCompany(id)
      if (res.error) {
        setError(res.error)
        return
      }
      router.push('/crm')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="ghost" onClick={onClick} disabled={pending} className="text-bad hover:text-bad">
        <Trash2 className="size-3.5" aria-hidden />
        {pending ? 'Deleting…' : 'Delete'}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  )
}
