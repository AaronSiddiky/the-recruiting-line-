import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { CALLING_HOURS, STATE_TIMEZONES } from '@/lib/constants'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Coerce user-supplied phone text to E.164. Returns null when it clearly isn't
 * a dialable US number, so bad CSV rows fail at import rather than at dial time.
 */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/** +12125550123 → (212) 555-0123 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '—'
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function timezoneForState(state: string | null | undefined): string | null {
  if (!state) return null
  return STATE_TIMEZONES[state.trim().toUpperCase()] ?? null
}

/**
 * Whether it is currently a civil hour to call this prospect. Unknown timezone
 * is treated as callable — refusing to dial on missing data would silently
 * shrink the queue with no visible reason.
 */
export function withinCallingHours(
  timezone: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!timezone) return true
  try {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      }).format(now),
    )
    return hour >= CALLING_HOURS.start && hour < CALLING_HOURS.end
  } catch {
    return true
  }
}

export function relativeDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso)
  const diffMs = Date.now() - then.getTime()
  const day = 86_400_000
  const days = Math.floor(diffMs / day)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
