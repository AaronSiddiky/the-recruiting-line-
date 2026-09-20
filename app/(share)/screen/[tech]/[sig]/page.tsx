import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyTech } from '@/lib/techs/screen-link'
import { ScreeningForm } from './screening-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'A few quick questions · The Recruiting Line' }

export default async function ScreenPage(props: PageProps<'/screen/[tech]/[sig]'>) {
  const { tech, sig } = await props.params
  if (!verifyTech(tech, sig)) notFound()

  const admin = createAdminClient()
  const FULL =
    'id, name, city, state, title, employer, years_hvac, role_pref, epa_cert, own_tools, drivers_license, commission_ok, pay_min, available_from, max_commute_miles, current_job, screening_at'
  // Fall back to the columns that existed before migration 0024, so the form
  // still renders on a database that has not been migrated yet.
  const BASE = 'id, name, city, state, title, employer'
  const full = await admin.from('techs').select(FULL).eq('id', tech).maybeSingle()
  const data = full.error ? (await admin.from('techs').select(BASE).eq('id', tech).maybeSingle()).data : full.data
  if (!data) notFound()

  return <ScreeningForm tech={data as never} action={`/api/screen/${tech}/${sig}`} />
}
