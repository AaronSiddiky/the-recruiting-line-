import 'server-only'
import twilio from 'twilio'
import { env } from '@/lib/env'

let cached: ReturnType<typeof twilio> | null = null

export function twilioClient() {
  if (!cached) {
    cached = twilio(env.twilioAccountSid, env.twilioAuthToken)
  }
  return cached
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
