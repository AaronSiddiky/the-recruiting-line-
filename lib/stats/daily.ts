import 'server-only'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'
import { STATS_OUTCOME_SINCE } from '@/lib/constants'

export const DAY_TZ = 'America/New_York'
/** Calls per rep per day that counts as a full day. */
export const DAILY_CALL_GOAL = Math.max(1, Number(process.env.DAILY_CALL_GOAL) || 50)

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
export const todayKey = () => dayFmt.format(new Date())

/** Unguessable key for the public scoreboard link. Derived, so no new secret to manage. */
export function scoreboardKey(): string {
  return createHash('sha256').update(`scoreboard:${env.webhookSecret}`).digest('base64url').slice(0, 20)
}

export function scoreboardPath(date = todayKey()) {
  return `/scoreboard/${scoreboardKey()}/${date}`
}

export type RepScore = { id: string; name: string; calls: number; pickups: number; interested: number; customers: number }
export type DailyScoreboard = { date: string; label: string; goal: number; reps: RepScore[] }

type Row = { agent_id: string | null; status: string; outcome: string | null; started_at: string }
const isCall = (r: Row) => (r.started_at < STATS_OUTCOME_SINCE ? r.status !== 'canceled' : r.outcome !== null)
const isPickup = (r: Row) =>
  r.started_at < STATS_OUTCOME_SINCE ? r.status === 'connected' : r.outcome !== null && r.outcome !== 'no_answer'

/** Eastern-day window as UTC instants. */
function dayBounds(date: string) {
  // Noon UTC on that date, then find the Eastern offset by formatting.
  const probe = new Date(`${date}T12:00:00Z`)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: DAY_TZ, hour: 'numeric', hour12: false }).formatToParts(probe)
  const easternHour = Number(parts.find((p) => p.type === 'hour')?.value ?? 12) % 24
  const offsetHours = 12 - easternHour // 4 in EDT, 5 in EST
  const start = new Date(`${date}T00:00:00Z`)
  start.setUTCHours(start.getUTCHours() + offsetHours)
  const end = new Date(start.getTime() + 86_400_000)
  return { start: start.toISOString(), end: end.toISOString() }
}

export async function dailyScoreboard(date: string): Promise<DailyScoreboard> {
  const admin = createAdminClient()
  const { start, end } = dayBounds(date)
  const [{ data: profiles }, { data: calls }] = await Promise.all([
    admin.from('profiles').select('id, full_name, email').order('created_at'),
    admin
      .from('calls')
      .select('agent_id, status, outcome, started_at')
      .neq('status', 'canceled')
      .gte('started_at', start)
      .lt('started_at', end)
      .limit(5000),
  ])
  const rows = (calls ?? []) as Row[]
  const reps: RepScore[] = (profiles ?? []).map((p) => {
    const mine = rows.filter((r) => r.agent_id === p.id)
    const raw = (p.full_name || p.email || 'Rep').split(/[.@\s]/)[0]
    return {
      id: p.id,
      name: raw.charAt(0).toUpperCase() + raw.slice(1),
      calls: mine.filter(isCall).length,
      pickups: mine.filter(isPickup).length,
      interested: mine.filter((r) => r.outcome === 'meeting_booked').length,
      customers: mine.filter((r) => r.outcome === 'customer').length,
    }
  })
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
  return { date, label, goal: DAILY_CALL_GOAL, reps }
}
