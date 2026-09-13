import { createClient } from '@/lib/supabase/server'
import { Dialer } from './dialer'

export default async function DialerPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return <Dialer queueSize={0} />

  // Mirrors the queue predicate in start_dial_batch, minus the per-session and
  // in-flight guards, so the idle screen shows an honest number. Chained .or()
  // clauses are ANDed together, which is what we want here.
  const today = new Date().toISOString().slice(0, 10)
  const { count } = await supabase
    .from('companies')
    .select('id', { count: 'exact', head: true })
    .eq('do_not_call', false)
    .or(`next_follow_up.is.null,next_follow_up.lte.${today}`)
    .or('response.is.null,response.eq.call_back')

  return <Dialer queueSize={count ?? 0} />
}
