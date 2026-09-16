import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatPhone, relativeDate } from '@/lib/utils'
import type { Company } from '@/types/db'

type LastCall = {
  company_id: string
  started_at: string
  notes: string | null
  ai_summary: { headline?: string; next_step?: string | null } | null
  agent: { full_name: string } | null
}

/**
 * Every company whose latest outcome is "Interested": the warm list. Ordered
 * by follow-up date so the ones due today sit on top, with what was said on
 * the last call and who said it.
 */
export default async function InterestedPage() {
  const supabase = await createClient()
  const { data: companies, error } = await supabase
    .from('companies')
    .select('id, name, phone, email, city, state, source, last_called_at, next_follow_up, notes, call_count')
    .eq('response', 'meeting_booked')
    .order('next_follow_up', { ascending: true, nullsFirst: false })
    .order('last_called_at', { ascending: false })

  const rows = (companies ?? []) as Pick<Company, 'id' | 'name' | 'phone' | 'email' | 'city' | 'state' | 'source' | 'last_called_at' | 'next_follow_up' | 'notes' | 'call_count'>[]

  // The call that set the outcome: the most recent one with an outcome per company.
  const last = new Map<string, LastCall>()
  if (rows.length) {
    const { data: calls } = await supabase
      .from('calls')
      .select('company_id, started_at, notes, ai_summary, agent:profiles!calls_agent_id_fkey(full_name)')
      .in('company_id', rows.map((r) => r.id))
      .eq('outcome', 'meeting_booked')
      .order('started_at', { ascending: false })
    for (const c of (calls ?? []) as unknown as LastCall[]) {
      if (!last.has(c.company_id)) last.set(c.company_id, c)
    }
  }
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5">
        <h1 className="text-sm font-semibold">Interested</h1>
        <span className="tnum text-xs text-muted">{rows.length} {rows.length === 1 ? 'company' : 'companies'}</span>
        <span className="ml-auto text-xs text-muted">Marked &ldquo;Interested&rdquo; on their last call. Due follow-ups first.</span>
      </div>

      {error ? (
        <div className="m-4 rounded-md border border-bad-bg bg-bad-bg px-3 py-2 text-sm text-bad">Could not load: {error.message}</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-12 text-center">
          <div>
            <p className="text-sm font-medium">Nobody marked Interested yet.</p>
            <p className="mt-1 text-xs text-muted">Pick &ldquo;Interested&rdquo; in the exit interview and they land here.</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                {['Company', 'Phone', 'Follow up', 'Last call', 'By', 'What they said', 'Calls'].map((h) => (
                  <th key={h} scope="col" className="border-b border-border-subtle bg-surface px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = last.get(r.id)
                const said = c?.notes || c?.ai_summary?.headline || r.notes || ''
                const due = r.next_follow_up
                return (
                  <tr key={r.id} className="hover:bg-surface">
                    <td className="border-b border-border-subtle px-3 py-2">
                      <Link href={`/companies/${r.id}`} className="font-medium hover:text-accent hover:underline">{r.name}</Link>
                      <div className="text-xs text-muted">{[r.city, r.state].filter(Boolean).join(', ')}{r.email ? ` · ${r.email}` : ''}</div>
                    </td>
                    <td className="tnum border-b border-border-subtle px-3 py-2 whitespace-nowrap">{formatPhone(r.phone)}</td>
                    <td className={`tnum border-b border-border-subtle px-3 py-2 whitespace-nowrap ${due && due <= today ? 'font-medium text-bad' : ''}`}>{due ?? '—'}</td>
                    <td className="border-b border-border-subtle px-3 py-2 whitespace-nowrap text-muted">{relativeDate(c?.started_at ?? r.last_called_at)}</td>
                    <td className="border-b border-border-subtle px-3 py-2 whitespace-nowrap text-muted">{c?.agent?.full_name ?? '—'}</td>
                    <td className="max-w-md border-b border-border-subtle px-3 py-2"><span className="line-clamp-2 text-xs">{said || <span className="text-muted-2">—</span>}</span></td>
                    <td className="tnum border-b border-border-subtle px-3 py-2 text-right">{r.call_count}</td>
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
