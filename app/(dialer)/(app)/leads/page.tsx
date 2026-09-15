import { createClient } from '@/lib/supabase/server'
import { LeadsToolbar } from './leads-toolbar'
import { LeadsTable, type LeadRow } from './leads-table'

const PAGE_SIZE = 100

const SORTABLE = {
  name: 'name',
  location: 'city',
  source: 'source',
  crm: 'reached_out',
} as const

export default async function LeadsPage(props: PageProps<'/leads'>) {
  const params = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  const q = (one(params.q) ?? '').trim()
  const reached = one(params.reached) ?? ''
  const assigned = one(params.assigned) ?? ''
  const sortKey = (one(params.sort) ?? 'name') as keyof typeof SORTABLE
  const column = SORTABLE[sortKey] ?? 'name'
  const ascending = (one(params.dir) ?? 'asc') !== 'desc'
  const page = Math.max(1, Number(one(params.page) ?? '1') || 1)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let query = supabase
    .from('companies')
    .select('id, name, phone, city, state, source, reached_out, call_count, owner_id', { count: 'exact' })

  if (q) {
    // Commas and parentheses are PostgREST filter syntax; strip them so a
    // search like "A&K, Inc." can't break the query.
    const safe = q.replace(/[,()]/g, ' ')
    const digits = q.replace(/\D/g, '')
    const filters = [`name.ilike.%${safe}%`, `source.ilike.%${safe}%`]
    if (digits.length >= 3) filters.push(`phone.ilike.%${digits}%`)
    query = query.or(filters.join(','))
  }
  if (reached === 'yes') query = query.eq('reached_out', true)
  if (reached === 'no') query = query.eq('reached_out', false)
  if (assigned === 'me' && user) query = query.eq('owner_id', user.id)
  else if (assigned === 'unassigned') query = query.is('owner_id', null)
  else if (/^[0-9a-f-]{36}$/.test(assigned)) query = query.eq('owner_id', assigned)

  const from = (page - 1) * PAGE_SIZE
  const [{ data, count, error }, { data: profiles }, { count: reachedCount }] = await Promise.all([
    query
      .order(column, { ascending, nullsFirst: false })
      .order('name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1),
    supabase.from('profiles').select('id, full_name').order('full_name'),
    supabase.from('companies').select('id', { count: 'exact', head: true }).eq('reached_out', true),
  ])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <LeadsToolbar
        total={count ?? 0}
        reachedTotal={reachedCount ?? 0}
        profiles={profiles ?? []}
        currentUserId={user?.id ?? null}
      />
      {error ? (
        <div className="m-4 rounded-md border border-bad-bg bg-bad-bg px-3 py-2 text-sm text-bad">
          Could not load leads: {error.message}
          {/column .* does not exist/.test(error.message) &&
            ' — run the latest file in supabase/migrations in the Supabase SQL editor.'}
        </div>
      ) : (
        <LeadsTable
          rows={(data ?? []) as LeadRow[]}
          profiles={profiles ?? []}
          currentUserId={user?.id ?? null}
          page={page}
          pageSize={PAGE_SIZE}
          total={count ?? 0}
        />
      )}
    </div>
  )
}
