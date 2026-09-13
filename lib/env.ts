/**
 * Fail loudly at first use rather than shipping `undefined` into the Twilio
 * SDK, where it surfaces four layers down as an opaque 401.
 */
function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    )
  }
  return value
}

export const env = {
  get supabaseUrl() {
    return required('NEXT_PUBLIC_SUPABASE_URL')
  },
  get supabasePublishableKey() {
    return required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
  },
  get supabaseSecretKey() {
    return required('SUPABASE_SECRET_KEY')
  },
  get twilioAccountSid() {
    return required('TWILIO_ACCOUNT_SID')
  },
  get twilioAuthToken() {
    return required('TWILIO_AUTH_TOKEN')
  },
  get twilioApiKeySid() {
    return required('TWILIO_API_KEY_SID')
  },
  get twilioApiKeySecret() {
    return required('TWILIO_API_KEY_SECRET')
  },
  get twimlAppSid() {
    return required('TWILIO_TWIML_APP_SID')
  },
  /**
   * Caller ID pool. Each line in a batch dials from a different number:
   * spreading volume across several numbers is what delays the carriers'
   * "Scam Likely" flag, and it keeps a batch from queueing behind a single
   * number's outbound rate limit.
   */
  get callerIds(): string[] {
    const ids = required('TWILIO_CALLER_IDS')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
    if (ids.length === 0) {
      throw new Error('TWILIO_CALLER_IDS must list at least one number.')
    }
    return ids
  },
  get appUrl() {
    return required('APP_URL').replace(/\/$/, '')
  },
  get webhookSecret() {
    return required('WEBHOOK_SECRET')
  },
  get anthropicApiKey() {
    return required('ANTHROPIC_API_KEY')
  },
  get deepgramApiKey() {
    return required('DEEPGRAM_API_KEY')
  },
}
