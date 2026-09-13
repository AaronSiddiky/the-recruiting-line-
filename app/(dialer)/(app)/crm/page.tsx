import { createClient } from '@/lib/supabase/server'
import { CrmToolbar } from './crm-toolbar'
import { CrmTable } from './crm-table'
import { CALL_OUTCOMES } from '@/lib/constants'
import type { CallOutcome, CompanyRow } from '@/types/db'

const PAGE_SIZE = 100

const SORTABLE = {
  name: 'name',
  location: 'city',
  calls: 'call_count',
  response: 'response',
  follow_up: 'next_follow_up',
  last_called: 'last_called_at',
} as const

type SortKey = keyof typeof SORTABLE

const OUTCOME_VALUES = new Set<CallOutcome>(CALL_OUTCOMES.map((o) => o.value))

export default async function CrmPage(props: PageProps<'/crm'>) {
  const params = await props.searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  const q = (one(params.q) ?? '').trim()
  // Never hand an unvalidated query-string value to an enum column: PostgREST
  // rejects it with a 400 and the whole page 500s on a typo'd URL.
  const rawResponse = one(params.response) ?? ''
  const response = OUTCOME_VALUES.has(rawResponse as CallOutcome)
    ? (rawResponse as CallOutcome)
    : rawResponse === 'none'
      ? 'none'
      : ''
  const owner = one(params.owner) ?? ''
  const due = one(params.due) === '1'
  const sortKey = (one(params.sort) ?? 'name') as SortKey
  const column = SORTABLE[sortKey] ?? 'name'
  const ascending = (one(params.dir) ?? 'asc') !== 'desc'
  const page = Math.max(1, Number(one(params.page) ?? '1') || 1)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let query = supabase
    .from('companies')
    .select('*, owner:profiles!companies_owner_id_fkey(id, full_name)', {
      count: 'exact',
    })

  if (q) {
    // Match either the company name or a phone number typed any which way.
    const digits = q.replace(/\D/g, '')
    const filters = [`name.ilike.%${q}%`]
    if (digits.length >= 3) filters.push(`phone.ilike.%${digits}%`)
    query = query.or(filters.join(','))
  }
  if (response === 'none') query = query.is('response', null)
  else if (response) query = query.eq('response', response)
  if (owner === 'me' && user) query = query.eq('owner_id', user.id)
  if (owner === 'unassigned') query = query.is('owner_id', null)
  if (due) query = query.lte('next_follow_up', new Date().toISOString().slice(0, 10))

  const from = (page - 1) * PAGE_SIZE
  const { data, count, error } = await query
    .order(column, { ascending, nullsFirst: false })
    .order('name', { ascending: true })
    .range(from, from + PAGE_SIZE - 1)

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name')
    .order('full_name')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CrmToolbar total={count ?? 0} />

      {error ? (
        <div className="m-4 rounded-md border border-bad-bg bg-bad-bg px-3 py-2 text-sm text-bad">
          Could not load companies: {error.message}
        </div>
      ) : (
        <CrmTable
          rows={(data ?? []) as unknown as CompanyRow[]}
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
