'use client'

import { useActionState } from 'react'
import { useSearchParams } from 'next/navigation'
import { signIn, type LoginState } from './actions'
import { Button } from '@/components/ui/button'

const INITIAL: LoginState = { error: null }

export function LoginForm() {
  const next = useSearchParams().get('next') ?? '/leads'
  const [state, action, pending] = useActionState(signIn, INITIAL)

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          className="h-9 rounded-md border border-border-strong px-2.5 focus:outline-2 focus:outline-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-9 rounded-md border border-border-strong px-2.5 focus:outline-2 focus:outline-accent"
        />
      </label>

      {state.error && (
        <p role="alert" className="text-xs text-bad">
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending} className="mt-1 h-9">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
