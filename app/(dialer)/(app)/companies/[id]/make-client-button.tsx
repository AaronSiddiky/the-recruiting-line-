'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { Handshake } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { makeClient } from '@/lib/actions/clients'

/** "They signed": turns the company into a client, or jumps to the existing one. */
export function MakeClientButton({ companyId, clientId }: { companyId: string; clientId: string | null }) {
  const [pending, startTransition] = useTransition()
  if (clientId) {
    return (
      <Link href={`/clients/${clientId}`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-good-bg px-3 text-sm font-medium text-good hover:underline">
        <Handshake className="size-3.5" aria-hidden />
        Client
      </Link>
    )
  }
  return (
    <Button onClick={() => startTransition(async () => { await makeClient(companyId) })} disabled={pending} title="They signed: open a client record with the contract and touch points">
      <Handshake className="size-3.5" aria-hidden />
      {pending ? 'Creating…' : 'Make client'}
    </Button>
  )
}
