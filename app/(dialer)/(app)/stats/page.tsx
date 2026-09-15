import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { STATS_SINCE } from '@/lib/constants'
import { CallHistory, type CallRow } from '../companies/[id]/call-history'

const RANGES = [
  { value: 'all', label: 'All time', days: null },
  { value: '30', label: '30 days', days: 30 },
  { value: '7', label: '7 days', days: 7 },
] as const

type Row = { agent_id: string | null; company_id: string; status: string; outcome: string | null }

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

  // One row per logged outcome. A four-line batch creates four call rows, but
  // only the leg that reached the exit interview is a conversation a rep
  // would count, so everything without an outcome is left out.
  const rows: Row[] = []
  let error: string | null = null
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = supabase
      .from('calls')
      .select('agent_id, company_id, status, outcome')
      .not('outcome', 'is', null)
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

  const reps = (profiles ?? []).map((p) => {
    const mine = rows.filter((r) => r.agent_id === p.id)
    return {
      id: p.id,
      name: p.full_name || p.email || 'Rep',
      calls: mine.length,
      // "No answer" is a voicemail or nobody there; anything else meant a person.
      pickups: mine.filter((r) => r.outcome !== 'no_answer').length,
      // A company is one customer no matter how many calls it took.
      customers: new Set(mine.filter((r) => r.outcome === 'customer').map((r) => r.company_id)).size,
    }
  })
  const team = {
    calls: rows.length,
    pickups: rows.filter((r) => r.outcome !== 'no_answer').length,
    customers: new Set(rows.filter((r) => r.outcome === 'customer').map((r) => r.company_id)).size,
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2.5">
        <h1 className="mr-2 text-sm font-semibold">Stats</h1>
        <nav className="flex gap-1" aria-label="Range">
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
                    <Rate n={r.customers} d={r.pickups} />
                  </tr>
                ))}
                <tr className="bg-surface">
                  <td className="px-4 py-3 font-semibold">Team</td>
                  <Num value={team.calls} bold />
                  <Num value={team.pickups} sub={pct(team.pickups, team.calls)} bold />
                  <Num value={team.customers} good={team.customers > 0} bold />
                  <Rate n={team.customers} d={team.pickups} bold />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            Counting from {new Date(STATS_SINCE).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
            Calls counts one per logged outcome, not per dialed line. Picked up is every outcome
            except &ldquo;No answer&rdquo;. Customers are companies marked &ldquo;Became a
            customer&rdquo;. Conversion is customers divided by calls picked up.
          </p>

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
