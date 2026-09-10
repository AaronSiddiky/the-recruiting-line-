'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const active = pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Link
      href={href}
      className={cn(
        'rounded-md px-2 py-1 text-sm transition-colors',
        active
          ? 'bg-surface-2 font-medium text-foreground'
          : 'text-muted hover:text-foreground',
      )}
    >
      {children}
    </Link>
  )
}
