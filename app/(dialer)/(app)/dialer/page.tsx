import { createClient } from '@/lib/supabase/server'
import { Dialer } from './dialer'

export default async function DialerPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return <Dialer queueSize={0} hasVoicemail={false} />

  // Mirrors the queue predicate in start_dial_batch, minus the per-session and
  // in-flight guards, so the idle screen shows an honest number. Chained .or()
  // clauses are ANDed together, which is what we want here.
  const today = new Date().toISOString().slice(0, 10)
  const [{ count }, { data: profile }] = await Promise.all([
    supabase
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('do_not_call', false)
      .not('phone', 'is', null)
      .or(`next_follow_up.is.null,next_follow_up.lte.${today}`)
      .or('response.is.null,response.eq.call_back,response.eq.no_answer,response.eq.not_interested,response.eq.not_hiring'),
    supabase.from('profiles').select('voicemail_path').eq('id', user.id).maybeSingle(),
  ])

  return <Dialer queueSize={count ?? 0} hasVoicemail={!!profile?.voicemail_path} />
}
