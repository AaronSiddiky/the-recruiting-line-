import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { twilioClient } from '@/lib/twilio/client'
import { TWILIO_CONCURRENT_CALLS } from '@/lib/constants'

/** Sessions polled within this window hold a softphone leg at Twilio. */
const AGENT_ALIVE_MS = 45_000
/**
 * A leg still dialing or ringing after this long is stale bookkeeping, not a
 * real Twilio call: nothing rings for three minutes.
 */
const RINGING_MAX_AGE_MS = 3 * 60_000
/**
 * A connected leg is a live conversation and holds its slot for as long as it
 * lasts. Counting it for only three minutes (as ringing legs are) made every
 * longer call look like a free slot, and a second rep dialed straight into
 * error 10004. This ceiling only guards against a row the webhooks never close.
 */
const TALKING_MAX_AGE_MS = 2 * 60 * 60_000

/**
 * How many more calls Twilio will accept right now, account-wide.
 *
 * Twilio counts every live call: each rep's softphone leg plus every
 * outbound leg that is dialing, ringing or connected. Anything over the cap
 * is rejected with error 10004 and no webhook, so it is far cheaper to not
 * ask than to find out. Both reps draw on the same budget, so two dialers
 * running at once share the lines instead of each losing some.
 */
/**
 * Calls Twilio itself says are live, every rep's line included. The count the
 * cap actually applies to. Null when Twilio can't be reached, so the caller
 * falls back to the database estimate rather than guessing zero.
 */
async function liveAtTwilio(): Promise<number | null> {
  try {
    const lists = await Promise.all(
      (['queued', 'ringing', 'in-progress'] as const).map((status) =>
        twilioClient().calls.list({ status, limit: 50 }),
      ),
    )
    return lists.reduce((sum, list) => sum + list.length, 0)
  } catch {
    return null
  }
}

export async function availableLines(): Promise<{ available: number; cap: number; agents: number; inFlight: number }> {
  const admin = createAdminClient()
  const now = Date.now()
  const [{ count: agents }, { count: ringing }, { count: talking }, twilioLive] = await Promise.all([
    admin
      .from('call_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .gte('last_seen_at', new Date(now - AGENT_ALIVE_MS).toISOString()),
    admin
      .from('calls')
      .select('id', { count: 'exact', head: true })
      .in('status', ['dialing', 'ringing'])
      .is('ended_at', null)
      .gte('started_at', new Date(now - RINGING_MAX_AGE_MS).toISOString()),
    admin
      .from('calls')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'connected')
      .is('ended_at', null)
      .gte('started_at', new Date(now - TALKING_MAX_AGE_MS).toISOString()),
    liveAtTwilio(),
  ])
  const a = agents ?? 1
  const f = (ringing ?? 0) + (talking ?? 0)
  // Take whichever count is higher. The database estimate infers reps' lines
  // from heartbeats, which can lag; it once counted a free slot while Twilio
  // held three live calls, and the dial came back error 10004. Twilio's list
  // can in turn trail a call reserved a moment ago, which the database counts.
  const used = Math.max(a + f, twilioLive ?? 0)
  return { available: Math.max(0, TWILIO_CONCURRENT_CALLS - used), cap: TWILIO_CONCURRENT_CALLS, agents: a, inFlight: Math.max(f, used - a) }
}
