'use client'

import { useState } from 'react'
import { Check, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Copies the public scoreboard link; pasting it into a chat unfurls today's numbers. */
export function ShareScoreboard({ url }: { url: string }) {
  const [done, setDone] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setDone(true)
      setTimeout(() => setDone(false), 2000)
    } catch {
      window.prompt('Copy this link:', url)
    }
  }
  return (
    <Button onClick={() => void copy()} title="Copy a link that shows today's scoreboard, with a preview card in iMessage, WhatsApp and Messenger">
      {done ? <Check className="size-3.5" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
      {done ? 'Copied' : "Share today's scoreboard"}
    </Button>
  )
}
