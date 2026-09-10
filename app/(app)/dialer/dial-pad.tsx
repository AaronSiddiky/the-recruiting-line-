'use client'

import { useCallback, useEffect, useState } from 'react'
import { Delete, Phone } from 'lucide-react'
import { cn, formatPhone, toE164 } from '@/lib/utils'

const KEYS = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
] as const

const DIALABLE = new Set<string>(KEYS.map(([k]) => k))

/**
 * Hand-dial a number.
 *
 * Two modes on the same keypad, because the physical thing it imitates has
 * two: before a call it composes a number, during a call each press sends a
 * DTMF tone so the agent can get through a phone tree.
 */
export function DialPad({
  onDial,
  onDigit,
  mode,
  busy,
}: {
  onDial: (phone: string) => void
  onDigit: (digit: string) => void
  mode: 'compose' | 'dtmf'
  busy: boolean
}) {
  const [value, setValue] = useState('')
  const [sent, setSent] = useState('')

  const press = useCallback(
    (key: string) => {
      if (mode === 'dtmf') {
        onDigit(key)
        setSent((s) => (s + key).slice(-24))
        return
      }
      setValue((v) => (v.length >= 20 ? v : v + key))
    },
    [mode, onDigit],
  )

  const submit = useCallback(() => {
    const e164 = toE164(value)
    if (!e164 || busy) return
    onDial(e164)
    setValue('')
  }, [value, busy, onDial])

  // Physical keyboard, so a rep can type a number instead of clicking twelve
  // buttons. Ignored while a text field elsewhere has focus.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

      if (DIALABLE.has(event.key)) {
        press(event.key)
      } else if (event.key === 'Backspace' && mode === 'compose') {
        event.preventDefault()
        setValue((v) => v.slice(0, -1))
      } else if (event.key === 'Enter' && mode === 'compose') {
        submit()
      } else if (event.key === '+' && mode === 'compose') {
        setValue((v) => (v ? v : '+'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, submit, mode])

  const parsed = toE164(value)
  const composing = mode === 'compose'

  return (
    <div className="w-64">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted">
          {composing ? 'Dial a number' : 'Keypad'}
        </span>
        {composing && value && !parsed && (
          <span className="text-xs text-bad">Not dialable</span>
        )}
      </div>

      <div className="mb-3 flex h-11 items-center rounded-md border border-border-strong px-3">
        <span
          className={cn(
            'tnum flex-1 truncate text-lg',
            !composing && 'text-muted',
            composing && !value && 'text-muted-2',
          )}
          aria-live="polite"
        >
          {composing ? value || 'Enter a number' : sent || 'Tones send to the call'}
        </span>

        {composing && value && (
          <button
            onClick={() => setValue((v) => v.slice(0, -1))}
            aria-label="Delete last digit"
            className="cursor-pointer text-muted-2 hover:text-foreground"
          >
            <Delete className="size-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.map(([key, letters]) => (
          <button
            key={key}
            onClick={() => press(key)}
            aria-label={`Dial ${key}`}
            className={cn(
              'flex h-12 cursor-pointer flex-col items-center justify-center rounded-md',
              'border border-border-subtle bg-background transition-colors',
              'hover:bg-surface-2 active:bg-neutral-bg',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            )}
          >
            <span className="tnum text-lg leading-none">{key}</span>
            {letters && (
              <span className="mt-0.5 text-[9px] tracking-widest text-muted-2">
                {letters}
              </span>
            )}
          </button>
        ))}
      </div>

      {composing && (
        <button
          onClick={submit}
          disabled={!parsed || busy}
          className={cn(
            'mt-2 flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md',
            'bg-good text-white font-medium transition-opacity',
            'disabled:cursor-not-allowed disabled:opacity-35',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          )}
        >
          <Phone className="size-4" aria-hidden />
          {busy ? 'Dialing…' : parsed ? `Call ${formatPhone(parsed)}` : 'Call'}
        </button>
      )}
    </div>
  )
}
