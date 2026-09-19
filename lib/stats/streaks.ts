import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { STATS_OUTCOME_SINCE } from '@/lib/constants'
import { DAY_TZ, todayKey } from '@/lib/stats/daily'

/** Days a rep must place at least this many calls for the day to count. */
export const STREAK_MIN_CALLS = Math.max(1, Number(process.env.STREAK_MIN_CALLS) || 1)
const HISTORY_DAYS = 70

export type DayCell = { date: string; calls: number; weekend: boolean; counted: boolean }
export type RepStreak = {
  id: string
  name: string
  current: number
  longest: number
  activeDays: number
  totalCalls: number
  calledToday: number
  lastActive: string | null
  days: DayCell[]
}

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const dayKey = (iso: string) => dayFmt.format(new Date(iso))

export function shiftDay(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function isWeekend(key: string): boolean {
  const dow = new Date(`${key}T12:00:00Z`).getUTCDay()
  return dow === 0 || dow === 6
}

/**
 * Consecutive working days with calls. Weekends are skipped rather than
 * counted: a Saturday off neither breaks a run nor extends it. Today counts
 * as alive until it ends, so a streak does not appear broken at 9am.
 */
export function streakFrom(active: Set<string>, today: string) {
  let current = 0
  let cursor = active.has(today) ? today : shiftDay(today, -1)
  for (let i = 0; i < 3650; i++) {
    if (isWeekend(cursor)) {
      cursor = shiftDay(cursor, -1)
      continue
    }
    if (!active.has(cursor)) break
    current++
    cursor = shiftDay(cursor, -1)
  }

  let longest = 0
  let run = 0
  const sorted = [...active].sort()
  if (sorted.length) {
    for (let k = sorted[0]; k <= today; k = shiftDay(k, 1)) {
      if (isWeekend(k)) continue
      if (active.has(k)) {
        run++
        if (run > longest) longest = run
      } else if (k !== today) run = 0
    }
  }
  return { current, longest: Math.max(longest, current) }
}

type Row = { agent_id: string | null; status: string; outcome: string | null; started_at: string }
const isCall = (r: Row) => (r.started_at < STATS_OUTCOME_SINCE ? r.status !== 'canceled' : r.outcome !== null)

/** Streaks for every rep, newest-first history for the calendar strip. */
export async function repStreaks(): Promise<{ today: string; minCalls: number; reps: RepStreak[] }> {
  const admin = createAdminClient()
  const today = todayKey()
  const since = shiftDay(today, -HISTORY_DAYS)

  const [{ data: profiles }, { data: calls }] = await Promise.all([
    admin.from('profiles').select('id, full_name, email').order('created_at'),
    admin
      .from('calls')
      .select('agent_id, status, outcome, started_at')
      .neq('status', 'canceled')
      .gte('started_at', `${since}T00:00:00Z`)
      .limit(20_000),
  ])

  const byRep = new Map<string, Map<string, number>>()
  for (const r of (calls ?? []) as Row[]) {
    if (!r.agent_id || !isCall(r)) continue
    const perDay = byRep.get(r.agent_id) ?? new Map<string, number>()
    const k = dayKey(r.started_at)
    perDay.set(k, (perDay.get(k) ?? 0) + 1)
    byRep.set(r.agent_id, perDay)
  }

  const reps: RepStreak[] = (profiles ?? []).map((p) => {
    const perDay = byRep.get(p.id) ?? new Map<string, number>()
    const active = new Set([...perDay.entries()].filter(([, n]) => n >= STREAK_MIN_CALLS).map(([d]) => d))
    const { current, longest } = streakFrom(active, today)
    const days: DayCell[] = []
    for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
      const date = shiftDay(today, -i)
      const n = perDay.get(date) ?? 0
      days.push({ date, calls: n, weekend: isWeekend(date), counted: n >= STREAK_MIN_CALLS })
    }
    const raw = (p.full_name || p.email || 'Rep').split(/[.@\s]/)[0]
    return {
      id: p.id,
      name: raw.charAt(0).toUpperCase() + raw.slice(1),
      current,
      longest,
      activeDays: active.size,
      totalCalls: [...perDay.values()].reduce((a, b) => a + b, 0),
      calledToday: perDay.get(today) ?? 0,
      lastActive: [...active].sort().pop() ?? null,
      days,
    }
  })

  reps.sort((a, b) => b.current - a.current || b.longest - a.longest || b.totalCalls - a.totalCalls)
  return { today, minCalls: STREAK_MIN_CALLS, reps }
}
