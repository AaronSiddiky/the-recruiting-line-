import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LogOut } from 'lucide-react'
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
    .select('full_name, email')
    .eq('id', user.id)
    .single()

  const name = profile?.full_name || profile?.email || user.email || ''

  return (
    <div className="flex h-dvh">
      {/* Icon rail on narrow screens, full sidebar from md up. */}
      <aside className="flex w-14 shrink-0 flex-col border-r border-border-subtle bg-surface md:w-52">
        <Link
          href="/leads"
          className="flex h-12 shrink-0 items-center justify-center border-b border-border-subtle px-3 text-sm font-semibold tracking-tight md:justify-start"
        >
          <span className="md:hidden">RL</span>
          <span className="hidden md:inline">RecruitingLine</span>
        </Link>

        <nav className="flex flex-col gap-0.5 p-2" aria-label="Main">
          <NavLink href="/leads" icon="leads">Leads</NavLink>
          <NavLink href="/crm" icon="crm">CRM</NavLink>
          <NavLink href="/dialer" icon="dialer">Dialer</NavLink>
          <NavLink href="/clients" icon="clients">Clients</NavLink>
          <NavLink href="/stats" icon="stats">Stats</NavLink>
        </nav>

        <div className="mt-auto border-t border-border-subtle p-2">
          <p className="hidden truncate px-2 pb-1.5 text-xs text-muted md:block" title={name}>
            {name}
          </p>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              title="Sign out"
              className="flex h-8 w-full cursor-pointer items-center justify-center gap-2.5 rounded-md px-2 text-sm text-muted hover:bg-surface-2/60 hover:text-foreground md:justify-start"
            >
              <LogOut className="size-4 shrink-0" aria-hidden />
              <span className="hidden md:inline">Sign out</span>
            </button>
          </form>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">{children}</main>
    </div>
  )
}
