import { Flame } from 'lucide-react'
import { repStreaks, type DayCell, type RepStreak } from '@/lib/stats/streaks'

export const dynamic = 'force-dynamic'

const label = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })

/** Who has kept calling, day after day. Weekends are skipped, not counted against anyone. */
export default async function StreaksPage() {
  const { today, minCalls, reps } = await repStreaks()
  const leader = reps[0]
  const best = [...reps].sort((a, b) => b.longest - a.longest)[0]

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-5">
      <h1 className="inline-flex items-center gap-2 text-xl font-semibold tracking-tight">
        <Flame className="size-5 text-orange-500" aria-hidden />
        Streaks
      </h1>
      <p className="mt-1 text-xs text-muted">
        A day counts when a rep logs {minCalls === 1 ? 'at least one call' : `${minCalls} calls`}. Weekends are skipped, so a quiet Saturday
        never breaks a run. Today stays alive until it ends. Eastern time.
      </p>

      {reps.length > 0 && leader && (
        <p className="mt-4 rounded-lg border border-border-subtle bg-surface px-4 py-3 text-sm">
          {leader.current > 0 ? (
            <>
              <span className="font-semibold">{leader.name}</span> is on a <span className="font-semibold text-orange-500">{leader.current}-day streak</span>
              {reps[1] && reps[1].current > 0 && reps[1].id !== leader.id && (
                <> · {reps[1].name} is {reps[1].current === leader.current ? 'level with them' : `${leader.current - reps[1].current} day${leader.current - reps[1].current === 1 ? '' : 's'} behind`}</>
              )}
              {best && best.longest > leader.current && <> · longest ever is {best.longest} days by {best.name}</>}
            </>
          ) : (
            <>Nobody has a live streak. One call today starts one.</>
          )}
        </p>
      )}

      <div className="mt-5 space-y-4">
        {reps.map((rep, i) => (
          <RepCard key={rep.id} rep={rep} rank={i + 1} today={today} />
        ))}
        {reps.length === 0 && <p className="text-sm text-muted">No reps yet.</p>}
      </div>
    </div>
  )
}

function RepCard({ rep, rank, today }: { rep: RepStreak; rank: number; today: string }) {
  const weeks: DayCell[][] = []
  for (let i = 0; i < rep.days.length; i += 7) weeks.push(rep.days.slice(i, i + 7))

  return (
    <section className="rounded-lg border border-border-subtle">
      <header className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-2.5">
        <span className="tnum w-5 text-sm text-muted-2">{rank}</span>
        <span className="text-sm font-semibold">{rep.name}</span>
        {rep.current > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-xs font-semibold text-orange-600">
            <Flame className="size-3" aria-hidden />
            {rep.current} day{rep.current === 1 ? '' : 's'}
          </span>
        )}
        <span className="tnum ml-auto text-xs text-muted">
          {rep.calledToday > 0 ? `${rep.calledToday} today` : 'nothing today yet'}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-px bg-border-subtle sm:grid-cols-4">
        <Stat label="Current streak" value={`${rep.current}d`} />
        <Stat label="Longest ever" value={`${rep.longest}d`} />
        <Stat label="Days with calls" value={String(rep.activeDays)} sub="last 10 weeks" />
        <Stat label="Calls" value={rep.totalCalls.toLocaleString()} sub="last 10 weeks" />
      </dl>

      <div className="flex flex-wrap gap-1 px-4 py-3" aria-label={`${rep.name}'s last ten weeks`}>
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((d) => (
              <span
                key={d.date}
                title={`${label(d.date)} · ${d.calls} call${d.calls === 1 ? '' : 's'}${d.weekend ? ' (weekend)' : ''}`}
                className={[
                  'size-3 rounded-[3px]',
                  d.counted
                    ? d.calls >= 40
                      ? 'bg-orange-600'
                      : d.calls >= 15
                        ? 'bg-orange-500'
                        : 'bg-orange-300'
                    : d.weekend
                      ? 'bg-surface-2'
                      : 'bg-border-subtle',
                  d.date === today ? 'ring-1 ring-foreground' : '',
                ].join(' ')}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-background px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tnum mt-0.5 text-lg font-semibold">{value}</dd>
      {sub && <dd className="text-xs text-muted-2">{sub}</dd>}
    </div>
  )
}
