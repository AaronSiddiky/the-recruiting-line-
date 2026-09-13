import { after } from 'next/server'
import { verifyTwilioRequest } from '@/lib/twilio/verify'
import { createAdminClient } from '@/lib/supabase/admin'
import { archiveRecording, summarizeCall } from '@/lib/ai/summarize'

/**
 * This handler downloads the recording, transcribes it, and runs a model call
 * inside `after()`. On Vercel that work still counts against the function's
 * execution budget, and the default 10s ceiling would kill it mid-transcription
 * leaving `ai_status` stuck on 'processing'.
 *
 * 60s is the Hobby-plan maximum. A long call can still exceed it -- the durable
 * fix is a queue (the `ai_status` column already models the states a worker
 * would need), but this makes ordinary calls work today.
 */
export const maxDuration = 60

/**
 * Twilio finished writing a recording.
 *
 * Archiving and summarizing happen after the response so Twilio's webhook
 * doesn't time out waiting on a download plus a transcription plus a model
 * call. Twilio retries a slow webhook, and a retried archive would upload the
 * same file twice.
 */
export async function POST(request: Request) {
  const verified = await verifyTwilioRequest(request)
  if (!verified) return new Response('Forbidden', { status: 403 })

  const { params, url } = verified
  const callId = url.searchParams.get('callId')
  const recordingSid = params.RecordingSid

  if (!callId || !recordingSid || params.RecordingStatus !== 'completed') {
    return new Response(null, { status: 204 })
  }

  const admin = createAdminClient()
  const { data: call } = await admin
    .from('calls')
    .select('company_id, recording_path')
    .eq('id', callId)
    .maybeSingle()

  if (!call || call.recording_path) return new Response(null, { status: 204 })

  const duration = params.RecordingDuration ? Number(params.RecordingDuration) : null

  after(async () => {
    try {
      const path = await archiveRecording(callId, recordingSid, call.company_id)

      await admin
        .from('calls')
        .update({
          recording_path: path,
          recording_duration: duration,
          ai_status: 'pending',
        })
        .eq('id', callId)

      await summarizeCall(callId)
    } catch (error) {
      await admin
        .from('calls')
        .update({
          ai_status: 'failed',
          ai_error: error instanceof Error ? error.message : 'Archiving failed',
        })
        .eq('id', callId)
    }
  })

  return new Response(null, { status: 204 })
}
