import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'

/**
 * Which caller IDs each rep dials from, keyed by login email. A prospect who
 * calls a number back reaches the same person's pool, and each number's volume
 * comes from one rep's pace instead of whoever happens to be dialing.
 *
 * This does not let two reps call at once: Twilio's concurrent-call cap is
 * per account, not per number (see TWILIO_CONCURRENT_CALLS).
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
 * The rep's numbers, rotated to a random starting point so a one- or two-line
 * batch doesn't always dial from the same number. Only numbers in
 * TWILIO_CALLER_IDS are used; a rep with no assignment gets the whole pool.
 */
export async function callerIdsFor(agentId: string): Promise<string[]> {
  const pool = env.callerIds
  const { data } = await createAdminClient().from('profiles').select('email').eq('id', agentId).maybeSingle()
  const assigned = (mapping()[(data?.email ?? '').toLowerCase()] ?? []).filter((n) => pool.includes(n))
  const ids = assigned.length > 0 ? assigned : pool
  const start = Math.floor(Math.random() * ids.length)
  return [...ids.slice(start), ...ids.slice(0, start)]
}
