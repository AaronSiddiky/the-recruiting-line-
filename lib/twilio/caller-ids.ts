import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { accountForAgent } from '@/lib/twilio/accounts'

/**
 * The one number each rep dials from, keyed by login email.
 *
 * One rep, one number -- not a rotating pool. Rotation existed to spread
 * spam-flagging risk across a four-line batch; with one call at a time there
 * is no batch to spread. What a fixed number buys instead: a prospect who has
 * seen the number before is likelier to answer, a callback reaches the rep who
 * actually dialled them, and each number's reputation belongs to one person
 * rather than being smeared across the team.
 *
 * Override without a code change with TWILIO_NUMBER_BY_REP, e.g.
 *   a@x.com=+15550000001;b@y.com=+15550000002
 */
const DEFAULT_BY_REP: Record<string, string> = {
  'aaron.siddiky@columbia.edu': '+12543646807',
  'leonard@holterholdings.com': '+15013006951',
}

function mapping(): Record<string, string> {
  // TWILIO_CALLER_IDS_BY_REP is the old pooled variable, still read so a
  // deployment that only sets that one keeps working: each rep's first number
  // becomes their number and the rest are retired.
  const raw = process.env.TWILIO_NUMBER_BY_REP ?? process.env.TWILIO_CALLER_IDS_BY_REP
  if (!raw) return DEFAULT_BY_REP
  const out: Record<string, string> = {}
  for (const entry of raw.split(';')) {
    const [email, numbers] = entry.split('=')
    const first = (numbers ?? '')
      .split('|')
      .map((n) => n.trim())
      .filter(Boolean)[0]
    if (email && first) out[email.trim().toLowerCase()] = first
  }
  return out
}

/**
 * The number this rep dials from. Always one, and always the same one.
 *
 * A rep with no number assigned -- or one assigned a number their Twilio
 * account does not own -- falls back to the first caller ID on that account.
 * Twilio rejects a `from` the account cannot use, so falling back beats
 * failing the dial outright.
 */
export async function callerIdFor(agentId: string): Promise<string> {
  const account = await accountForAgent(agentId)
  if (account.callerIds.length === 0) {
    throw new Error(`No caller IDs are configured for the ${account.key} Twilio account.`)
  }
  const { data } = await createAdminClient()
    .from('profiles')
    .select('email')
    .eq('id', agentId)
    .maybeSingle()
  const assigned = mapping()[(data?.email ?? '').toLowerCase()]
  return assigned && account.callerIds.includes(assigned) ? assigned : account.callerIds[0]
}
