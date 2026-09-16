import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { formatPhone, relativeDate } from '@/lib/utils'
import type { Client, ClientTouchpoint } from '@/types/db'

type Row = Client & {
  company: { id: string; name: string; phone: string | null; city: string | null; state: string | null } | null
  winner: { id: string; full_name: string } | null
}

const money = (cents: number | null | undefined) =>
  cents == null ? '—' : `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

const STATUS_TONE = { active: 'good', paused: 'warn', ended: 'neutral' } as const

export default async function ClientsPage() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .select('*, company:companies(id, name, phone, city, state), winner:profiles!clients_won_by_fkey(id, full_name)')
    .order('signed_at', { ascending: false, nullsFirst: false })
  const rows = (data ?? []) as unknown as Row[]

  const { data: touches } = rows.length
    ? await supabase
        .from('client_touchpoints')
        .select('client_id, at, next_follow_up')
        .in('client_id', rows.map((r) => r.id))
        .order('at', { ascending: false })
    : { data: [] as Pick<ClientTouchpoint, 'client_id' | 'at' | 'next_follow_up'>[] }

  const last = new Map<string, string>()
  const next = new Map<string, string>()
  for (const t of touches ?? []) {
    if (!last.has(t.client_id)) last.set(t.client_id, t.at)
    if (t.next_follow_up && (!next.has(t.client_id) || t.next_follow_up < next.get(t.client_id)!)) next.set(t.client_id, t.next_follow_up)
  }
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5">
        <h1 className="text-sm font-semibold">Clients</h1>
        <span className="tnum text-xs text-muted">
          {rows.length} signed · {rows.filter((r) => r.status === 'active').length} active
        </span>
        <span className="ml-auto text-xs text-muted">
          Sign a new one? Open the company&rsquo;s page and press &ldquo;Make client&rdquo;.
        </span>
      </div>

      {error ? (
        <div className="m-4 rounded-md border border-bad-bg bg-bad-bg px-3 py-2 text-sm text-bad">
          Could not load clients: {error.message}
          {/relation .* does not exist|schema cache/.test(error.message) && ' — run supabase/migrations/0016_clients.sql in the Supabase SQL editor.'}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-12 text-center">
          <div>
            <p className="text-sm font-medium">No clients yet.</p>
            <p className="mt-1 text-xs text-muted">When a company signs, open its page from the CRM and press &ldquo;Make client&rdquo;.</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                {['Client', 'Contact', 'Won by', 'Signed', 'Fee / hire', 'Guarantee', 'Last touch', 'Next follow-up', 'Status'].map((h) => (
                  <th key={h} scope="col" className="border-b border-border-subtle bg-surface px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const due = next.get(r.id)
                return (
                  <tr key={r.id} className="hover:bg-surface">
                    <td className="border-b border-border-subtle px-3 py-2">
                      <Link href={`/clients/${r.id}`} className="font-medium hover:text-accent hover:underline">{r.company?.name ?? 'Unknown company'}</Link>
                      <div className="text-xs text-muted">{[r.company?.city, r.company?.state].filter(Boolean).join(', ')}{r.company?.phone ? ` · ${formatPhone(r.company.phone)}` : ''}</div>
                    </td>
                    <td className="border-b border-border-subtle px-3 py-2 whitespace-nowrap">{r.contact_name ?? '—'}{r.contact_title ? <span className="text-xs text-muted"> · {r.contact_title}</span> : null}</td>
                    <td className="border-b border-border-subtle px-3 py-2 whitespace-nowrap">{r.winner?.full_name ?? '—'}</td>
                    <td className="tnum border-b border-border-subtle px-3 py-2 whitespace-nowrap">{r.signed_at ?? '—'}</td>
                    <td className="tnum border-b border-border-subtle px-3 py-2 whitespace-nowrap">{money(r.fee_cents)}</td>
                    <td className="tnum border-b border-border-subtle px-3 py-2 whitespace-nowrap">{r.guarantee_days != null ? `${r.guarantee_days} days` : '—'}</td>
                    <td className="border-b border-border-subtle px-3 py-2 whitespace-nowrap text-muted">{relativeDate(last.get(r.id))}</td>
                    <td className={`tnum border-b border-border-subtle px-3 py-2 whitespace-nowrap ${due && due <= today ? 'font-medium text-bad' : ''}`}>{due ?? '—'}</td>
                    <td className="border-b border-border-subtle px-3 py-2"><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
