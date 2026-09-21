import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { twilioClient } from '@/lib/twilio/client'
import { agentIdsOn, type TwilioAccount } from '@/lib/twilio/accounts'
import { repAllowance } from '@/lib/twilio/allowance'

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
 * Calls Twilio itself says are live, every rep's line included. The count the
 * cap actually applies to. Null when Twilio can't be reached, so the caller
 * falls back to the database estimate rather than guessing zero.
 */
async function liveAtTwilio(account: TwilioAccount): Promise<number | null> {
  try {
    const lists = await Promise.all(
      (['queued', 'ringing', 'in-progress'] as const).map((status) =>
        twilioClient(account).calls.list({ status, limit: 50 }),
      ),
    )
    return lists.reduce((sum, list) => sum + list.length, 0)
  } catch {
    return null
  }
}

export async function availableLines(
  account: TwilioAccount,
  agentId?: string | null,
): Promise<{ available: number; cap: number; agents: number; inFlight: number }> {
  const admin = createAdminClient()
  // Only the reps on this account, and their calls, count against its cap.
  // With one account configured that is everyone (null: no filter).
  const reps = await agentIdsOn(account)
  const now = Date.now()

  let sessions = admin
    .from('call_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .gte('last_seen_at', new Date(now - AGENT_ALIVE_MS).toISOString())
  let ringingQ = admin
    .from('calls')
    .select('id', { count: 'exact', head: true })
    .in('status', ['dialing', 'ringing'])
    .is('ended_at', null)
    .gte('started_at', new Date(now - RINGING_MAX_AGE_MS).toISOString())
  let talkingQ = admin
    .from('calls')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'connected')
    .is('ended_at', null)
    .gte('started_at', new Date(now - TALKING_MAX_AGE_MS).toISOString())
  if (reps) {
    sessions = sessions.in('agent_id', reps)
    ringingQ = ringingQ.in('agent_id', reps)
    talkingQ = talkingQ.in('agent_id', reps)
  }

  // This rep's own legs, counted against their own share rather than the pool.
  const mineQ = agentId
    ? admin
        .from('calls')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .in('status', ['dialing', 'ringing', 'connected'])
        .is('ended_at', null)
        .gte('started_at', new Date(now - TALKING_MAX_AGE_MS).toISOString())
    : Promise.resolve({ count: 0 })

  const [{ count: agents }, { count: ringing }, { count: talking }, { count: mine }, twilioLive] = await Promise.all([
    sessions,
    ringingQ,
    talkingQ,
    mineQ,
    liveAtTwilio(account),
  ])
  const a = agents ?? 1
  const f = (ringing ?? 0) + (talking ?? 0)
  // Take whichever count is higher. The database estimate infers reps' lines
  // from heartbeats, which can lag; it once counted a free slot while Twilio
  // held three live calls, and the dial came back error 10004. Twilio's list
  // can in turn trail a call reserved a moment ago, which the database counts.
  const used = Math.max(a + f, twilioLive ?? 0)
  const available = repAllowance({ cap: account.cap, agents: a, myLive: mine ?? 0, accountUsed: used })
  return { available, cap: account.cap, agents: a, inFlight: Math.max(f, used - a) }
}
