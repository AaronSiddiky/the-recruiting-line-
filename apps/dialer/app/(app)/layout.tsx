import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NavLink } from '@/components/nav-link'

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, role')
    .eq('id', user.id)
    .single()

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-6 border-b border-border-subtle bg-background px-4">
        <Link href="/crm" className="text-sm font-semibold tracking-tight">
          RecruitingLine
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink href="/crm">CRM</NavLink>
          <NavLink href="/dialer">Dialer</NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted">
            {profile?.full_name || profile?.email || user.email}
          </span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="cursor-pointer text-xs text-muted hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  )
}
