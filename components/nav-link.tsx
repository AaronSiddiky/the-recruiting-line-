'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, BarChart3, CalendarClock, Flame, Handshake, Phone, Table2, ThumbsUp, Users, Wrench, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS: Record<string, LucideIcon> = { leads: Users, crm: Table2, dialer: Phone, interested: ThumbsUp, clients: Handshake, techs: Wrench, techInterviews: CalendarClock, stats: BarChart3, streaks: Flame, health: Activity }

export function NavLink({
  href,
  icon,
  badge,
  children,
}: {
  href: string
  icon: keyof typeof ICONS
  /** Small count on the right, e.g. techs due for their weekly touch. */
  badge?: number
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
      {badge ? (
        <span className="tnum ml-auto hidden rounded-full bg-bad px-1.5 text-[10px] leading-4 font-semibold text-white md:inline" title={`${badge} due`}>
          {badge}
        </span>
      ) : null}
    </Link>
  )
}
