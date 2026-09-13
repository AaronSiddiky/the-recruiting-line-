import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { DeepgramClient } from '@deepgram/sdk'
import { twilioClient } from '@/lib/twilio/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'
import type { AiSummary } from '@/types/db'

const SummarySchema = z.object({
  headline: z
    .string()
    .describe('One line, under 90 characters, stating what happened on this call.'),
  summary: z
    .string()
    .describe('Two to four sentences covering what was discussed and how it ended.'),
  objections: z
    .array(z.string())
    .describe('Concerns or pushback the prospect raised, in their own framing. Empty if none.'),
  commitments: z
    .array(z.string())
    .describe('Anything either side agreed to do. Empty if none.'),
  suggested_outcome: z
    .enum(['meeting_booked', 'not_interested', 'wrong_number', 'call_back', 'customer'])
    .nullable()
    .describe('Which disposition the transcript supports, or null if genuinely unclear.'),
  next_step: z
    .string()
    .nullable()
    .describe('The single concrete next action, or null if there is none.'),
})

const SYSTEM_PROMPT = `You summarize recruiting cold calls for the recruiter who made them.

The transcript is dual-channel: PROSPECT is the person who was called, RECRUITER is the caller.

Write for someone who will read this six weeks from now with no memory of the call. Be concrete: use the names, numbers, dates and job titles that were actually said. Do not soften a rejection into something warmer than it was, and do not invent a next step that nobody agreed to.

If the call was too short or garbled to summarize, say so plainly in the headline rather than guessing.`

/**
 * Transcribe a recording and summarize it.
 *
 * Dual-channel audio is what makes this work: Deepgram's multichannel mode
 * gives us channel 0 (the prospect) and channel 1 (the recruiter) separately,
 * so the transcript is speaker-attributed without diarization guesswork.
 */
export async function summarizeCall(callId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: call } = await admin
    .from('calls')
    .select('id, recording_path, ai_status')
    .eq('id', callId)
    .maybeSingle()

  if (!call?.recording_path) return
  if (call.ai_status === 'processing' || call.ai_status === 'ready') return

  await admin.from('calls').update({ ai_status: 'processing' }).eq('id', callId)

  try {
    const { data: file, error: downloadError } = await admin.storage
      .from('recordings')
      .download(call.recording_path)

    if (downloadError || !file) {
      throw new Error(`Could not read recording: ${downloadError?.message ?? 'missing'}`)
    }

    const transcript = await transcribe(Buffer.from(await file.arrayBuffer()))

    if (!transcript.trim()) {
      await admin
        .from('calls')
        .update({
          ai_status: 'ready',
          transcript: '',
          ai_summary: {
            headline: 'No speech detected on the recording.',
            summary: 'The recording contains no audible conversation.',
            objections: [],
            commitments: [],
            suggested_outcome: null,
            next_step: null,
          } satisfies AiSummary,
        })
        .eq('id', callId)
      return
    }

    const summary = await summarize(transcript)

    await admin
      .from('calls')
      .update({ ai_status: 'ready', transcript, ai_summary: summary, ai_error: null })
      .eq('id', callId)
  } catch (error) {
    await admin
      .from('calls')
      .update({
        ai_status: 'failed',
        ai_error: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('id', callId)
  }
}

async function transcribe(audio: Buffer): Promise<string> {
  const deepgram = new DeepgramClient({ apiKey: env.deepgramApiKey })

  const response = await deepgram.listen.v1.media.transcribeFile(audio, {
    model: 'nova-3',
    multichannel: true, // channel 0 = prospect, channel 1 = recruiter
    punctuate: true,
    smart_format: true,
    utterances: true,
  })

  // The response is a union: an async request would return only a request_id.
  // We never pass a callback, so anything without `results` is a bug upstream.
  if (!('results' in response)) {
    throw new Error('Deepgram returned an async acknowledgement, not a transcript.')
  }

  const speaker = (channel: number | undefined) =>
    channel === 0 ? 'PROSPECT' : 'RECRUITER'

  const utterances = response.results.utterances
  if (utterances?.length) {
    return utterances
      .map((u) => `${speaker(u.channel)}: ${u.transcript}`)
      .join('\n')
  }

  return (
    response.results.channels
      ?.map((channel, i) => {
        const text = channel.alternatives?.[0]?.transcript ?? ''
        return text ? `${speaker(i)}: ${text}` : ''
      })
      .filter(Boolean)
      .join('\n') ?? ''
  )
}

async function summarize(transcript: string): Promise<AiSummary> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey })

  const response = await client.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    // Summarizing a two-minute call is routine work; low effort keeps the
    // per-call cost down without measurably changing the output.
    output_config: {
      effort: 'low',
      format: zodOutputFormat(SummarySchema),
    },
    messages: [
      {
        role: 'user',
        content: `Summarize this recruiting call.\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ],
  })

  if (!response.parsed_output) {
    throw new Error('Model did not return a parseable summary.')
  }

  return response.parsed_output
}

/**
 * Pull the audio off Twilio and into our own private bucket.
 *
 * Twilio's recording URLs require account credentials, so they can never be
 * handed to a browser. Copying the file once means playback is a signed URL
 * from our own storage, and the recording outlives Twilio's retention.
 */
export async function archiveRecording(
  callId: string,
  recordingSid: string,
  companyId: string,
): Promise<string> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}/Recordings/${recordingSid}.mp3`
  const auth = Buffer.from(
    `${env.twilioAccountSid}:${env.twilioAuthToken}`,
  ).toString('base64')

  const response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } })
  if (!response.ok) {
    throw new Error(`Twilio returned ${response.status} for recording ${recordingSid}`)
  }

  const path = `${companyId}/${callId}.mp3`
  const admin = createAdminClient()

  const { error } = await admin.storage
    .from('recordings')
    .upload(path, await response.arrayBuffer(), {
      contentType: 'audio/mpeg',
      upsert: true,
    })

  if (error) throw new Error(`Could not store recording: ${error.message}`)

  // Twilio bills monthly storage for every recording it keeps. We have our own
  // copy now, so let theirs go.
  await twilioClient()
    .recordings(recordingSid)
    .remove()
    .catch(() => undefined)

  return path
}
