import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import twilio from 'twilio'
import { env } from '@/lib/env'

export type VerifiedWebhook = {
  params: Record<string, string>
  url: URL
}

function secretMatches(candidate: string | null): boolean {
  if (!candidate) return false
  const expected = Buffer.from(env.webhookSecret)
  const actual = Buffer.from(candidate)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/**
 * Validate an inbound Twilio webhook.
 *
 * Two independent checks, because either one alone has a failure mode:
 *
 *  - The X-Twilio-Signature HMAC proves the request came from our Twilio
 *    account. It breaks the moment a proxy rewrites the URL, which is exactly
 *    when people disable it and forget.
 *  - The `s` query secret survives proxying, but leaks if a URL is ever logged.
 *
 * Requiring both means a single mistake is not enough to let a forged request
 * create calls on our account.
 *
 * The signed URL must be reconstructed from APP_URL: behind ngrok or Vercel,
 * request.url carries the internal host, and the HMAC will not match.
 */
export async function verifyTwilioRequest(
  request: Request,
): Promise<VerifiedWebhook | null> {
  const requestUrl = new URL(request.url)

  if (!secretMatches(requestUrl.searchParams.get('s'))) {
    return null
  }

  const body = await request.text()
  const params = Object.fromEntries(new URLSearchParams(body)) as Record<string, string>

  const signature = request.headers.get('x-twilio-signature')
  if (!signature) return null

  const signedUrl = `${env.appUrl}${requestUrl.pathname}${requestUrl.search}`
  const valid = twilio.validateRequest(
    env.twilioAuthToken,
    signature,
    signedUrl,
    params,
  )

  if (!valid) return null

  return { params, url: requestUrl }
}

/** TwiML responses must be served as XML or Twilio treats them as an error. */
export function twiml(xml: string) {
  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}
