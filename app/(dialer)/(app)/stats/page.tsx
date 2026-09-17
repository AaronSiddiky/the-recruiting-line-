import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { STATS_OUTCOME_SINCE, STATS_SINCE } from '@/lib/constants'
import { CallHistory, type CallRow } from '../companies/[id]/call-history'
import { ShareScoreboard } from './share-button'
import { scoreboardPath } from '@/lib/stats/daily'

const RANGES = [
  { value: 'all', label: 'All time', days: null },
  { value: '30', label: '30 days', days: 30 },
  { value: '7', label: '7 days', days: 7 },
] as const

type Row = { agent_id: string | null; company_id: string; status: string; outcome: string | null; started_at: string }

/**
 * Before the cutover a call was any line that rang; after it a call is a
 * logged outcome. "Picked up" follows the same split.
 */
const isCall = (r: Row) => (r.started_at < STATS_OUTCOME_SINCE ? r.status !== 'canceled' : r.outcome !== null)
const isPickup = (r: Row) =>
  r.started_at < STATS_OUTCOME_SINCE ? r.status === 'connected' : r.outcome !== null && r.outcome !== 'no_answer'

const PAGE = 1000
const MAX_ROWS = 50_000
const RECORDINGS_LIMIT = 100

export default async function StatsPage(props: PageProps<'/stats'>) {
  const params = await props.searchParams
  const raw = Array.isArray(params.range) ? params.range[0] : params.range
  const range = RANGES.find((r) => r.value === raw) ?? RANGES[0]

  const supabase = await createClient()
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .order('created_at')

  // Fetch every non-canceled row and apply the counting rule per row, since it
  // depends on when the call happened (see isCall).
  const rows: Row[] = []
  let error: string | null = null
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = supabase
      .from('calls')
      .select('agent_id, company_id, status, outcome, started_at')
      .neq('status', 'canceled')
      .gte('started_at', STATS_SINCE)
      .order('started_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (range.days) {
      q = q.gte('started_at', sinceIso(range.days))
    }
    const { data, error: e } = await q
    if (e) {
      error = e.message
      break
    }
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < PAGE) break
  }

  let recQ = supabase
    .from('calls')
    .select('*, agent:profiles!calls_agent_id_fkey(id, full_name), company:companies(id, name)')
    .not('recording_path', 'is', null)
    .gte('started_at', STATS_SINCE)
    .order('started_at', { ascending: false })
    .limit(RECORDINGS_LIMIT)
  if (range.days) recQ = recQ.gte('started_at', sinceIso(range.days))
  const { data: recordings } = await recQ

  // Signed clients, credited to whoever won the account. Not time-ranged: a
  // signed contract stays won.
  const { data: clientRows } = await supabase.from('clients').select('won_by')
  const clientsBy = new Map<string, number>()
  for (const c of clientRows ?? []) if (c.won_by) clientsBy.set(c.won_by, (clientsBy.get(c.won_by) ?? 0) + 1)

  const reps = (profiles ?? []).map((p) => {
    const mine = rows.filter((r) => r.agent_id === p.id)
    return {
      id: p.id,
      name: p.full_name || p.email || 'Rep',
      calls: mine.filter(isCall).length,
      pickups: mine.filter(isPickup).length,
      // A company is one customer no matter how many calls it took.
      customers: new Set(mine.filter((r) => r.outcome === 'customer').map((r) => r.company_id)).size,
      clients: clientsBy.get(p.id) ?? 0,
    }
  })
  // Calls per day per rep, newest first, using the same counting rule.
  const perDay = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if (!isCall(r) || !r.agent_id) continue
    const k = dayKey(r.started_at)
    const m = perDay.get(k) ?? new Map<string, number>()
    m.set(r.agent_id, (m.get(r.agent_id) ?? 0) + 1)
    perDay.set(k, m)
  }
  const days = [...perDay.keys()].sort().reverse()
  const today = dayKey(new Date().toISOString())

  const team = {
    calls: rows.filter(isCall).length,
    pickups: rows.filter(isPickup).length,
    customers: new Set(rows.filter((r) => r.outcome === 'customer').map((r) => r.company_id)).size,
    clients: (clientRows ?? []).length,
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
        <h1 className="mr-2 text-sm font-semibold">Stats</h1>
        <ShareScoreboard url={`https://www.therecruitingline.com${scoreboardPath()}`} />
        <nav className="ml-2 flex gap-1" aria-label="Range">
          {RANGES.map((r) => (
            <Link
              key={r.value}
              href={r.value === 'all' ? '/stats' : `/stats?range=${r.value}`}
              aria-current={r.value === range.value ? 'page' : undefined}
              className={cn(
                'rounded-md px-2 py-1 text-sm',
                r.value === range.value
                  ? 'bg-surface-2 font-medium text-foreground'
                  : 'text-muted hover:text-foreground',
              )}
            >
              {r.label}
            </Link>
          ))}
        </nav>
      </div>

      {error ? (
        <div className="m-4 rounded-md border border-bad-bg bg-bad-bg px-3 py-2 text-sm text-bad">
          Could not load calls: {error}
        </div>
      ) : (
        <div className="mx-auto w-full max-w-5xl px-4 py-6">
          <div className="overflow-hidden rounded-lg border border-border-subtle">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-surface text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">Rep</th>
                  <th className="px-4 py-2 text-right font-medium">Calls</th>
                  <th className="px-4 py-2 text-right font-medium">Picked up</th>
                  <th className="px-4 py-2 text-right font-medium">Customers</th>
                  <th className="px-4 py-2 text-right font-medium">Clients signed</th>
                  <th className="px-4 py-2 text-right font-medium">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {reps.map((r) => (
                  <tr key={r.id} className="border-b border-border-subtle">
                    <td className="px-4 py-3 font-medium">{r.name}</td>
                    <Num value={r.calls} />
                    <Num value={r.pickups} sub={pct(r.pickups, r.calls)} />
                    <Num value={r.customers} good={r.customers > 0} />
                    <Num value={r.clients} good={r.clients > 0} />
                    <Rate n={r.customers} d={r.pickups} />
                  </tr>
                ))}
                <tr className="bg-surface">
                  <td className="px-4 py-3 font-semibold">Team</td>
                  <Num value={team.calls} bold />
                  <Num value={team.pickups} sub={pct(team.pickups, team.calls)} bold />
                  <Num value={team.customers} good={team.customers > 0} bold />
                  <Num value={team.clients} good={team.clients > 0} bold />
                  <Rate n={team.customers} d={team.pickups} bold />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            Counting from {new Date(STATS_SINCE).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
            Since Sep 15, 2026, Calls counts one per logged outcome and Picked up is every outcome
            except &ldquo;No answer&rdquo;; earlier calls keep the original per-line count. Customers are companies marked &ldquo;Became a
            customer&rdquo;. Clients signed is every signed contract on the Clients page, credited to
            whoever won it, all time. Conversion is customers divided by calls picked up.
          </p>

          <h2 className="mt-8 mb-1 text-sm font-semibold">Calls per day</h2>
          <p className="mb-3 text-xs text-muted">Counted the same way as the totals above. Days in Eastern time.</p>
          {days.length === 0 ? (
            <p className="text-sm text-muted">No calls in this range.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border-subtle">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle bg-surface text-left text-xs text-muted">
                    <th className="px-4 py-2 font-medium">Day</th>
                    {reps.map((r) => (
                      <th key={r.id} className="px-4 py-2 text-right font-medium">{r.name}</th>
                    ))}
                    <th className="px-4 py-2 text-right font-medium">Team</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => {
                    const m = perDay.get(d)!
                    const total = [...m.values()].reduce((a, b) => a + b, 0)
                    return (
                      <tr key={d} className={cn('border-b border-border-subtle last:border-b-0', d === today && 'bg-surface')}>
                        <td className="tnum px-4 py-2 whitespace-nowrap">
                          {dayLabel(d)}
                          {d === today && <span className="ml-2 text-xs text-muted">today</span>}
                        </td>
                        {reps.map((r) => (
                          <td key={r.id} className="tnum px-4 py-2 text-right">{m.get(r.id) ?? 0}</td>
                        ))}
                        <td className="tnum px-4 py-2 text-right font-semibold">{total}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <h2 className="mt-8 mb-1 text-sm font-semibold">Recordings</h2>
          <p className="mb-3 text-xs text-muted">
            Latest {RECORDINGS_LIMIT} recorded calls. Expand one to play it, read the notes,
            and see the AI summary. Click the company name for its full history.
          </p>
          <CallHistory calls={(recordings ?? []) as unknown as CallRow[]} showCompany />
        </div>
      )}
    </div>
  )
}

const DAY_TZ = 'America/New_York'
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const dayKey = (iso: string) => dayFmt.format(new Date(iso))
const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })

function sinceIso(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function pct(n: number, d: number) {
  return d ? `${Math.round((n / d) * 100)}%` : undefined
}

function Rate({ n, d, bold }: { n: number; d: number; bold?: boolean }) {
  return (
    <td className={cn('tnum px-4 py-3 text-right', bold && 'font-semibold')}>
      <span className="text-lg leading-none">{d ? `${Math.round((n / d) * 100)}%` : '—'}</span>
    </td>
  )
}

function Num({ value, sub, good, bold }: { value: number; sub?: string; good?: boolean; bold?: boolean }) {
  return (
    <td className={cn('tnum px-4 py-3 text-right', bold && 'font-semibold', good && 'text-good')}>
      <span className="text-lg leading-none">{value.toLocaleString()}</span>
      {sub && <span className="ml-1.5 text-xs font-normal text-muted-2">{sub}</span>}
    </td>
  )
}
