import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { phoneHealth, type NumberHealth } from '@/lib/twilio/health'
import { Badge } from '@/components/ui/badge'
import { formatPhone } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const VERDICT: Record<NumberHealth['verdict'], { tone: 'good' | 'warn' | 'bad' | 'neutral'; label: string }> = {
  good: { tone: 'good', label: 'Healthy' },
  watch: { tone: 'warn', label: 'Watch' },
  bad: { tone: 'bad', label: 'Likely spam-labelled' },
  quiet: { tone: 'neutral', label: 'Not enough data' },
}

const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`)
const secondsAgo = (iso: string, now: string) => Math.max(0, Math.round((new Date(now).getTime() - new Date(iso).getTime()) / 1000))
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

export default async function HealthPage() {
  const h = await phoneHealth()
  const ok = h.problems.length === 0 && h.failures.length === 0

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Phone health</h1>
          <p className="text-xs text-muted">Live from Twilio and the database · checked {when(h.checkedAt)}</p>
        </div>
        <Link href="/health" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-3 text-sm hover:bg-surface-2">
          <RefreshCw className="size-3.5" aria-hidden />
          Re-check
        </Link>
      </div>

      <section className={`mt-5 rounded-lg border px-4 py-3 ${ok ? 'border-good-bg bg-good-bg text-good' : 'border-bad-bg bg-bad-bg text-bad'}`}>
        {ok ? (
          <p className="text-sm font-medium">Everything looks healthy.</p>
        ) : (
          <>
            <p className="text-sm font-medium">{h.problems.length + h.failures.length} thing{h.problems.length + h.failures.length === 1 ? '' : 's'} need attention</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm">
              {h.problems.map((p) => <li key={p}>{p}</li>)}
              {h.failures.map((f) => <li key={f}>Could not check: {f}</li>)}
            </ul>
          </>
        )}
      </section>

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-4">
        <Stat label="Twilio account" value={h.account ? `${h.account.type} · ${h.account.status}` : '—'} sub={h.account?.name} />
        <Stat label="Calls at Twilio now" value={`${h.concurrency.inFlightAtTwilio + h.concurrency.agentsLive} / ${h.concurrency.cap}`} sub={`${h.concurrency.agentsLive} rep line${h.concurrency.agentsLive === 1 ? '' : 's'} · ${h.concurrency.inFlightAtTwilio} prospect leg${h.concurrency.inFlightAtTwilio === 1 ? '' : 's'} · ${h.concurrency.headroom} free`} />
        <Stat label="Today" value={`${h.app.connectedToday} connected`} sub={`${h.app.dialedToday} dialed`} />
        <Stat label="Last conversation" value={when(h.app.lastConnectedAt)} />
      </dl>

      <h2 className="mt-8 mb-2 text-sm font-semibold">Caller IDs <span className="ml-2 font-normal text-muted-2">last 7 days</span></h2>
      <div className="overflow-hidden rounded-lg border border-border-subtle">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle bg-surface text-left text-xs text-muted">
              <th className="px-3 py-2 font-medium">Number</th>
              <th className="px-3 py-2 text-right font-medium">Dialed</th>
              <th className="px-3 py-2 text-right font-medium">Answered</th>
              <th className="px-3 py-2 text-right font-medium">No answer</th>
              <th className="px-3 py-2 text-right font-medium">Rejected</th>
              <th className="px-3 py-2 text-right font-medium">Answer rate</th>
              <th className="px-3 py-2 font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {h.numbers.map((n) => (
              <tr key={n.number} className="border-b border-border-subtle last:border-b-0">
                <td className="tnum px-3 py-2 whitespace-nowrap">
                  {formatPhone(n.number)}
                  {!n.inPool && <span className="ml-2 text-xs text-muted-2">not in pool</span>}
                  {n.voiceCapable === false && <span className="ml-2 text-xs text-bad">no voice</span>}
                </td>
                <td className="tnum px-3 py-2 text-right">{n.dialed}</td>
                <td className="tnum px-3 py-2 text-right">{n.answered}</td>
                <td className="tnum px-3 py-2 text-right">{n.noAnswer + n.busy}</td>
                <td className="tnum px-3 py-2 text-right">{n.failed}</td>
                <td className="tnum px-3 py-2 text-right">{pct(n.answerRate)}</td>
                <td className="px-3 py-2"><Badge tone={VERDICT[n.verdict].tone}>{VERDICT[n.verdict].label}</Badge><span className="ml-2 text-xs text-muted">{n.note}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Answered = completed with talk time. Rejected = Twilio refused to place the call (usually the concurrent-call cap). A number whose answer rate collapses while others hold up is being labelled spam: rest it and register it with the carriers.
      </p>

      <h2 className="mt-8 mb-2 text-sm font-semibold">Twilio errors <span className="ml-2 font-normal text-muted-2">last 24 hours</span></h2>
      {h.errors.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border-subtle">
          {h.errors.map((e, i) => (
            <li key={e.code} className={`flex items-baseline gap-3 px-3 py-2 text-sm ${i ? 'border-t border-border-subtle' : ''}`}>
              <span className="tnum w-14 shrink-0 font-mono text-xs text-muted">{e.code}</span>
              <span className="tnum w-10 shrink-0 text-right font-medium">{e.count}×</span>
              <span className="min-w-0 flex-1">{e.meaning}</span>
              <span className="shrink-0 text-xs text-muted-2">last {when(e.last)}</span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 mb-2 text-sm font-semibold">Dialing right now</h2>
      {h.app.activeSessions.length === 0 ? (
        <p className="text-sm text-muted">Nobody has the dialer open.</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border-subtle">
          {h.app.activeSessions.map((s, i) => (
            <li key={`${s.rep}:${s.startedAt}`} className={`flex items-center gap-3 px-3 py-2 text-sm ${i ? 'border-t border-border-subtle' : ''}`}>
              <span className="font-medium">{s.rep}</span>
              <span className="text-muted">since {when(s.startedAt)}</span>
              <span className="tnum ml-auto text-xs text-muted">{s.lines} line{s.lines === 1 ? '' : 's'} out · seen {secondsAgo(s.lastSeenAt, h.checkedAt)}s ago</span>
            </li>
          ))}
        </ul>
      )}
      {h.app.stuckLegs > 0 && <p className="mt-2 text-xs text-bad">{h.app.stuckLegs} stuck line{h.app.stuckLegs === 1 ? '' : 's'} will be cleared by the dialer within a minute.</p>}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="bg-background px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tnum mt-0.5 text-sm font-medium">{value}</dd>
      {sub && <dd className="text-xs text-muted-2">{sub}</dd>}
    </div>
  )
}
