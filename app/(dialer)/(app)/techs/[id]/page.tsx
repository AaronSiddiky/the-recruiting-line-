import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { rankMatches, type MatchClient } from '@/lib/techs/match'
import { TechDetail } from './tech-detail'
import { CallHistory, type CallRow } from '../../companies/[id]/call-history'
import type { Tech, TechPresentation, TechTouchpoint } from '@/types/db'

export default async function TechPage(props: PageProps<'/techs/[id]'>) {
  const { id } = await props.params
  const supabase = await createClient()
  const [{ data: tech }, { data: clients }, { data: touches }, { data: presentations }, { data: calls }] = await Promise.all([
    supabase.from('techs').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('clients')
      .select('id, status, role_type, requires_own_tools, commission_pay, min_years, epa_required, pay_min, pay_max, openings, company:companies(id, name, city)'),
    supabase
      .from('tech_touchpoints')
      .select('*, author:profiles!tech_touchpoints_user_id_fkey(full_name)')
      .eq('tech_id', id)
      .order('at', { ascending: false }),
    supabase.from('tech_presentations').select('*').eq('tech_id', id),
    // Losing legs of a parallel batch never rang them, so they are left out.
    supabase
      .from('calls')
      .select('*, agent:profiles!calls_agent_id_fkey(id, full_name)')
      .eq('tech_id', id)
      .neq('status', 'canceled')
      .order('started_at', { ascending: false }),
  ])
  if (!tech) notFound()
  const t = tech as Tech
  const matches = rankMatches(t, (clients ?? []) as unknown as MatchClient[])

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-5">
      <Link href="/techs" className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
        <ArrowLeft className="size-3" aria-hidden />
        Back to techs
      </Link>
      <TechDetail
        tech={t}
        matches={matches}
        touchpoints={(touches ?? []) as unknown as (TechTouchpoint & { author: { full_name: string } | null })[]}
        presentations={(presentations ?? []) as TechPresentation[]}
        calls={<CallHistory calls={(calls ?? []) as unknown as CallRow[]} />}
        callCount={(calls ?? []).length}
      />
    </div>
  )
}
