import { Suspense } from 'react'
import { LoginForm } from './login-form'

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4">
      <div className="w-full max-w-xs">
        <div className="mb-6">
          <h1 className="text-lg font-semibold tracking-tight">RecruitingLine</h1>
          <p className="mt-0.5 text-xs text-muted">
            Sign in to reach your dial queue.
          </p>
        </div>

        <div className="rounded-lg border border-border-subtle bg-background p-5">
          <Suspense fallback={<div className="h-52" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-4 text-center text-xs text-muted-2">
          Accounts are created by an admin in Supabase.
        </p>
      </div>
    </main>
  )
}
