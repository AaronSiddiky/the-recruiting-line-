import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, MapPin, Phone } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { OutcomeBadge } from '@/components/ui/badge'
import { formatPhone } from '@/lib/utils'
import { CompanyHeaderFields } from './header-fields'
import { CallHistory } from './call-history'
import type { Call, CompanyRow, Profile } from '@/types/db'

export default async function CompanyPage(props: PageProps<'/companies/[id]'>) {
  const { id } = await props.params
  const supabase = await createClient()

  const [{ data: company }, { data: profiles }] = await Promise.all([
    supabase
      .from('companies')
      .select('*, owner:profiles!companies_owner_id_fkey(id, full_name)')
      .eq('id', id)
      .maybeSingle(),
    supabase.from('profiles').select('id, full_name').order('full_name'),
  ])

  if (!company) notFound()

  // Losing legs of a parallel batch are excluded: the prospect never heard a
  // ring, so showing them here would misrepresent the relationship.
  const { data: calls } = await supabase
    .from('calls')
    .select('*, agent:profiles!calls_agent_id_fkey(id, full_name)')
    .eq('company_id', id)
    .neq('status', 'canceled')
    .order('started_at', { ascending: false })

  const row = company as unknown as CompanyRow
  const connected = (calls ?? []).filter((c) => c.answered_at).length

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-5">
      <Link
        href="/crm"
        className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-3" aria-hidden />
        Back to CRM
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{row.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            {(row.city || row.state) && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {[row.city, row.state].filter(Boolean).join(', ')}
              </span>
            )}
            <span className="tnum inline-flex items-center gap-1">
              <Phone className="size-3.5" aria-hidden />
              {formatPhone(row.phone)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <OutcomeBadge outcome={row.response} />
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-4">
        <Stat label="Calls" value={String(row.call_count)} />
        <Stat label="Connected" value={String(connected)} />
        <Stat
          label="Last called"
          value={
            row.last_called_at
              ? new Date(row.last_called_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })
              : '—'
          }
        />
        <Stat label="Next follow-up" value={row.next_follow_up ?? '—'} />
      </dl>

      <CompanyHeaderFields
        company={row}
        profiles={(profiles ?? []) as Pick<Profile, 'id' | 'full_name'>[]}
      />

      <h2 className="mt-8 mb-3 text-sm font-semibold">
        Call history
        <span className="tnum ml-2 font-normal text-muted-2">
          {(calls ?? []).length}
        </span>
      </h2>

      <CallHistory
        calls={
          (calls ?? []) as unknown as (Call & {
            agent: Pick<Profile, 'id' | 'full_name'> | null
          })[]
        }
      />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tnum mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  )
}
