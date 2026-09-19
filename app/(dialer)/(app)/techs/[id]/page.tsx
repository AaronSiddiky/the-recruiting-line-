import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { rankMatches, type MatchClient } from '@/lib/techs/match'
import { TechDetail } from './tech-detail'
import type { Tech, TechPresentation, TechTouchpoint } from '@/types/db'

export default async function TechPage(props: PageProps<'/techs/[id]'>) {
  const { id } = await props.params
  const supabase = await createClient()
  const [{ data: tech }, { data: clients }, { data: touches }, { data: presentations }] = await Promise.all([
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
      />
    </div>
  )
}
