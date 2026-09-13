'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Phone, Table2, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS: Record<string, LucideIcon> = { leads: Users, crm: Table2, dialer: Phone }

export function NavLink({
  href,
  icon,
  children,
}: {
  href: string
  icon: keyof typeof ICONS
  children: React.ReactNode
}) {
  const pathname = usePathname()
  // A company page is reached from the CRM, so it keeps CRM highlighted.
  const active =
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === '/crm' && pathname.startsWith('/companies/'))
  const Icon = ICONS[icon]

  return (
    <Link
      href={href}
      title={typeof children === 'string' ? children : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors',
        'justify-center md:justify-start',
        active
          ? 'bg-surface-2 font-medium text-foreground'
          : 'text-muted hover:bg-surface-2/60 hover:text-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="hidden md:inline">{children}</span>
    </Link>
  )
}
