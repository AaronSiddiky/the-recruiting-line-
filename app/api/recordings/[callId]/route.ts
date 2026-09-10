import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Recordings live in a private bucket. Rather than handing the browser a
 * storage path (or, worse, the Twilio URL, which carries account credentials),
 * we mint a short-lived signed URL per playback under the caller's own session.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/recordings/[callId]'>,
) {
  const { callId } = await ctx.params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  // RLS decides whether this user may see the call at all.
  const { data: call } = await supabase
    .from('calls')
    .select('recording_path')
    .eq('id', callId)
    .single()

  if (!call?.recording_path) {
    return NextResponse.json({ error: 'No recording.' }, { status: 404 })
  }

  const { data, error } = await supabase.storage
    .from('recordings')
    .createSignedUrl(call.recording_path, 60 * 10)

  if (error || !data) {
    return NextResponse.json({ error: 'Could not sign recording.' }, { status: 500 })
  }

  return NextResponse.redirect(data.signedUrl)
}
