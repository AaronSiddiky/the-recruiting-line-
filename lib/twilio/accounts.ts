import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'
import { TWILIO_CONCURRENT_CALLS } from '@/lib/constants'

/**
 * The Twilio accounts the dialer places calls through, and which rep uses
 * which.
 *
 * Twilio's concurrent-call cap is per account, and each rep's own line holds
 * one of those slots all session. On a cap of 3, two reps on one account share
 * a single prospect leg and take turns. Putting each rep on their own account
 * gives each a full cap.
 *
 * The primary account comes from TWILIO_*. A second account is configured with
 * the same variables prefixed TWILIO2_ (all of ACCOUNT_SID, AUTH_TOKEN,
 * API_KEY_SID, API_KEY_SECRET, TWIML_APP_SID, CALLER_IDS; CONCURRENT_CALLS is
 * optional). Until it is, every rep stays on the primary account.
 */
export type TwilioAccount = {
  key: 'primary' | 'second'
  accountSid: string
  authToken: string
  apiKeySid: string
  apiKeySecret: string
  twimlAppSid: string
  callerIds: string[]
  cap: number
}

const numbers = (raw: string | undefined) => (raw ?? '').split(',').map((n) => n.trim()).filter(Boolean)

let cachedAccounts: TwilioAccount[] | null = null

export function allAccounts(): TwilioAccount[] {
  if (cachedAccounts) return cachedAccounts
  const accounts: TwilioAccount[] = [
    {
      key: 'primary',
      accountSid: env.twilioAccountSid,
      authToken: env.twilioAuthToken,
      apiKeySid: env.twilioApiKeySid,
      apiKeySecret: env.twilioApiKeySecret,
      twimlAppSid: env.twimlAppSid,
      callerIds: env.callerIds,
      cap: TWILIO_CONCURRENT_CALLS,
    },
  ]
  const e = process.env
  const second = {
    accountSid: e.TWILIO2_ACCOUNT_SID,
    authToken: e.TWILIO2_AUTH_TOKEN,
    apiKeySid: e.TWILIO2_API_KEY_SID,
    apiKeySecret: e.TWILIO2_API_KEY_SECRET,
    twimlAppSid: e.TWILIO2_TWIML_APP_SID,
  }
  const callerIds = numbers(e.TWILIO2_CALLER_IDS)
  const provided = Object.values(second).filter(Boolean).length
  if (provided === Object.keys(second).length && callerIds.length > 0) {
    accounts.push({
      key: 'second',
      ...(second as Record<keyof typeof second, string>),
      callerIds,
      cap: Math.max(2, Number(e.TWILIO2_CONCURRENT_CALLS) || 3),
    })
  } else if (provided > 0) {
    // Half-configured is worse than not configured: fail loudly instead of
    // quietly leaving everyone on the primary account.
    throw new Error(
      'The second Twilio account is only partly configured. Set all of TWILIO2_ACCOUNT_SID, TWILIO2_AUTH_TOKEN, ' +
        'TWILIO2_API_KEY_SID, TWILIO2_API_KEY_SECRET, TWILIO2_TWIML_APP_SID and TWILIO2_CALLER_IDS, or none of them.',
    )
  }
  cachedAccounts = accounts
  return accounts
}

export function primaryAccount(): TwilioAccount {
  return allAccounts()[0]
}

/** Webhooks carry the AccountSid of the account that sent them. */
export function accountBySid(sid: string | null | undefined): TwilioAccount | null {
  return allAccounts().find((a) => a.accountSid === sid) ?? null
}

/**
 * Which account each rep dials through, by login email. Override with
 * TWILIO_ACCOUNT_BY_REP, e.g. "leonard@holterholdings.com=second". A rep not
 * listed, or listed for an account that isn't configured, uses the primary.
 */
const DEFAULT_ACCOUNT_BY_REP: Record<string, TwilioAccount['key']> = {
  'leonard@holterholdings.com': 'second',
}

function accountKeyForEmail(email: string | null | undefined): TwilioAccount['key'] {
  const raw = process.env.TWILIO_ACCOUNT_BY_REP
  let map = DEFAULT_ACCOUNT_BY_REP
  if (raw) {
    map = {}
    for (const entry of raw.split(';')) {
      const [who, key] = entry.split('=').map((s) => s?.trim())
      if (who && (key === 'primary' || key === 'second')) map[who.toLowerCase()] = key
    }
  }
  const key = map[(email ?? '').toLowerCase()] ?? 'primary'
  return allAccounts().some((a) => a.key === key) ? key : 'primary'
}

function byKey(key: TwilioAccount['key']): TwilioAccount {
  return allAccounts().find((a) => a.key === key) ?? primaryAccount()
}

export async function accountForAgent(agentId: string | null | undefined): Promise<TwilioAccount> {
  if (!agentId || allAccounts().length === 1) return primaryAccount()
  const { data } = await createAdminClient().from('profiles').select('email').eq('id', agentId).maybeSingle()
  return byKey(accountKeyForEmail(data?.email))
}

export async function accountForSession(sessionId: string): Promise<TwilioAccount> {
  if (allAccounts().length === 1) return primaryAccount()
  const { data } = await createAdminClient().from('call_sessions').select('agent_id').eq('id', sessionId).maybeSingle()
  return accountForAgent(data?.agent_id)
}

export async function accountForCall(callId: string): Promise<TwilioAccount> {
  if (allAccounts().length === 1) return primaryAccount()
  const { data } = await createAdminClient().from('calls').select('agent_id').eq('id', callId).maybeSingle()
  return accountForAgent(data?.agent_id)
}

/** Every rep who dials through this account: its share of the call budget. */
export async function agentIdsOn(account: TwilioAccount): Promise<string[] | null> {
  if (allAccounts().length === 1) return null // one account: everyone, no filter needed
  const { data } = await createAdminClient().from('profiles').select('id, email')
  return (data ?? []).filter((p) => accountKeyForEmail(p.email) === account.key).map((p) => p.id)
}
