import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { accountForAgent, agentIdsOn } from '@/lib/twilio/accounts'

/**
 * Which caller IDs each rep dials from, keyed by login email, when two reps
 * share one Twilio account. A rep alone on an account uses all of its numbers.
 *
 * Override without a code change by setting TWILIO_CALLER_IDS_BY_REP, e.g.
 *   a@x.com=+15550000001|+15550000002;b@y.com=+15550000003
 */
const DEFAULT_BY_REP: Record<string, string[]> = {
  // Busiest number paired with the least used, so both pools age evenly.
  'aaron.siddiky@columbia.edu': ['+12543646807', '+13252307022'],
  'leonard@holterholdings.com': ['+15013006951', '+19403295810'],
}

function mapping(): Record<string, string[]> {
  const raw = process.env.TWILIO_CALLER_IDS_BY_REP
  if (!raw) return DEFAULT_BY_REP
  const out: Record<string, string[]> = {}
  for (const entry of raw.split(';')) {
    const [email, numbers] = entry.split('=')
    if (email && numbers) out[email.trim().toLowerCase()] = numbers.split('|').map((n) => n.trim()).filter(Boolean)
  }
  return out
}

/**
 * The numbers this rep dials from on their Twilio account, rotated to a
 * random starting point so a one- or two-line batch doesn't always use the
 * same number. Only numbers owned by that account are ever returned.
 */
export async function callerIdsFor(agentId: string): Promise<string[]> {
  const account = await accountForAgent(agentId)
  const pool = account.callerIds
  const reps = await agentIdsOn(account)
  let ids = pool
  if (!reps || reps.length > 1) {
    // Shared account: split its numbers between the reps on it.
    const { data } = await createAdminClient().from('profiles').select('email').eq('id', agentId).maybeSingle()
    const assigned = (mapping()[(data?.email ?? '').toLowerCase()] ?? []).filter((n) => pool.includes(n))
    if (assigned.length > 0) ids = assigned
  }
  const start = Math.floor(Math.random() * ids.length)
  return [...ids.slice(start), ...ids.slice(0, start)]
}
