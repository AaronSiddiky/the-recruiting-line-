import 'server-only'
import twilio from 'twilio'
import { env } from '@/lib/env'
import { primaryAccount, type TwilioAccount } from '@/lib/twilio/accounts'

const clients = new Map<string, ReturnType<typeof twilio>>()

/** REST client for one Twilio account; the primary one when none is given. */
export function twilioClient(account: TwilioAccount = primaryAccount()) {
  let client = clients.get(account.accountSid)
  if (!client) {
    client = twilio(account.accountSid, account.authToken)
    clients.set(account.accountSid, client)
  }
  return client
}

/** Absolute webhook URL Twilio can reach, with the shared secret attached. */
export function webhookUrl(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${env.appUrl}${path}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  url.searchParams.set('s', env.webhookSecret)
  return url.toString()
}
