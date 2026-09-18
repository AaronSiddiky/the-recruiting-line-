import { NextResponse } from 'next/server'
import twilio from 'twilio'
import { createClient } from '@/lib/supabase/server'
import { accountForAgent } from '@/lib/twilio/accounts'

const TOKEN_TTL_SECONDS = 60 * 60

/**
 * Mint a short-lived Voice access token for the browser softphone. Scoped to
 * the signed-in user's id, so a token can never be used to impersonate another
 * rep's client.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  // The rep's line lives on their own Twilio account, so it counts against
  // that account's concurrent-call cap and nobody else's.
  const account = await accountForAgent(user.id)
  const { AccessToken } = twilio.jwt
  const token = new AccessToken(
    account.accountSid,
    account.apiKeySid,
    account.apiKeySecret,
    { identity: `agent_${user.id}`, ttl: TOKEN_TTL_SECONDS },
  )

  token.addGrant(
    new AccessToken.VoiceGrant({
      outgoingApplicationSid: account.twimlAppSid,
      incomingAllow: false,
    }),
  )

  return NextResponse.json({
    token: token.toJwt(),
    identity: `agent_${user.id}`,
    expiresIn: TOKEN_TTL_SECONDS,
  })
}
