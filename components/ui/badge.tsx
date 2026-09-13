import { cn } from '@/lib/utils'
import type { CallOutcome, CallStatus } from '@/types/db'
import { OUTCOME_LABELS, STATUS_LABELS } from '@/lib/constants'

const TONE = {
  good: 'bg-good-bg text-good',
  bad: 'bg-bad-bg text-bad',
  warn: 'bg-warn-bg text-warn',
  neutral: 'bg-neutral-bg text-muted',
} as const

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode
  tone?: keyof typeof TONE
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

const OUTCOME_TONE: Record<CallOutcome, keyof typeof TONE> = {
  meeting_booked: 'good',
  call_back: 'warn',
  not_interested: 'bad',
  wrong_number: 'neutral',
  customer: 'good',
}

export function OutcomeBadge({ outcome }: { outcome: CallOutcome | null }) {
  if (!outcome) return <span className="text-muted-2">—</span>
  return <Badge tone={OUTCOME_TONE[outcome]}>{OUTCOME_LABELS[outcome]}</Badge>
}

const STATUS_TONE: Record<CallStatus, keyof typeof TONE> = {
  dialing: 'neutral',
  ringing: 'warn',
  connected: 'good',
  no_answer: 'neutral',
  busy: 'neutral',
  failed: 'bad',
  voicemail: 'warn',
  canceled: 'neutral',
}

export function StatusBadge({ status }: { status: CallStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
}
