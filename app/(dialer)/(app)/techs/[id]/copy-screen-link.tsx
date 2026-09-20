'use client'

import { useState } from 'react'
import { Check, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The link to text a tech during the call. Copying it with a ready-made line
 * saves typing it out on a phone keyboard mid-conversation.
 */
export function CopyScreenLink({ url, firstName, compact = false }: { url: string; firstName?: string | null; compact?: boolean }) {
  const [done, setDone] = useState(false)
  const message = `Hi${firstName ? ` ${firstName}` : ''}, Leonard from The Recruiting Line. Here are those quick questions so I can match you to the right HVAC shop: ${url}`

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 2000)
    } catch {
      window.prompt('Copy this:', text)
    }
  }

  if (compact) {
    return (
      <button type="button" onClick={() => void copy(message)} className="cursor-pointer text-xs text-muted underline hover:text-foreground">
        {done ? 'Copied — paste it into a text' : 'Copy screening link to text them'}
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={() => void copy(message)}>
        {done ? <Check className="size-3.5" aria-hidden /> : <ClipboardList className="size-3.5" aria-hidden />}
        {done ? 'Copied' : 'Copy screening link + message'}
      </Button>
      <a href={`sms:?&body=${encodeURIComponent(message)}`} className="inline-flex h-8 items-center rounded-md border border-border-strong px-3 text-sm hover:bg-surface-2">
        Open in Messages
      </a>
      <code className="truncate text-xs text-muted-2">{url}</code>
    </div>
  )
}
