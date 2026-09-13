import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'
import { env } from '@/lib/env'

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * This exists for one reason: Twilio webhooks arrive with no user session, and
 * they need to write call rows. Never import this into a Client Component, and
 * never use it to serve data that a user-scoped query could serve instead --
 * every use of it is a place where you are personally responsible for
 * authorization.
 */
let cached: ReturnType<typeof createClient<Database>> | null = null

export function createAdminClient() {
  if (!cached) {
    cached = createClient<Database>(env.supabaseUrl, env.supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return cached
}
