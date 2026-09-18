import { createClient } from '@/lib/supabase/server'
import { TechsTable } from './techs-table'
import type { Tech, TechStatus, Profile } from '@/types/db'

export default async function TechsPage(props: PageProps<'/techs'>) {
  const params = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const q = (one(params.q) ?? '').trim()
  const status = one(params.status) ?? ''

  const supabase = await createClient()
  let query = supabase.from('techs').select('*').order('applied_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
  const STATUSES = new Set<string>(['new', 'reviewing', 'contacting', 'interviewing', 'placed', 'rejected'])
  if (STATUSES.has(status)) query = query.eq('status', status as TechStatus)
  if (q) {
    const safe = q.replace(/[,()]/g, ' ')
    query = query.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%,city.ilike.%${safe}%,title.ilike.%${safe}%,employer.ilike.%${safe}%,experience.ilike.%${safe}%`)
  }
  const [{ data, error }, { data: profiles }, { data: clients }] = await Promise.all([
    query.limit(500),
    supabase.from('profiles').select('id, full_name').order('full_name'),
    supabase.from('clients').select('company_id, company:companies(id, name)').eq('status', 'active'),
  ])
  const placeable = ((clients ?? []) as unknown as { company: { id: string; name: string } | null }[])
    .map((c) => c.company)
    .filter((c): c is { id: string; name: string } => !!c)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error ? (
        <div className="m-4 rounded-md border border-bad-bg bg-bad-bg px-3 py-2 text-sm text-bad">
          Could not load techs: {error.message}
          {/relation .* does not exist|schema cache/.test(error.message) && ' — run supabase/migrations/0020_techs.sql in the Supabase SQL editor.'}
        </div>
      ) : (
        <TechsTable rows={(data ?? []) as Tech[]} profiles={(profiles ?? []) as Pick<Profile, 'id' | 'full_name'>[]} clients={placeable} q={q} status={status} />
      )}
    </div>
  )
}
