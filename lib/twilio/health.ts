import 'server-only'
import { twilioClient } from '@/lib/twilio/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'
import { TWILIO_CONCURRENT_CALLS } from '@/lib/constants'

export type NumberHealth = {
  number: string
  inPool: boolean
  voiceCapable: boolean | null
  dialed: number
  answered: number
  noAnswer: number
  busy: number
  failed: number
  answerRate: number | null
  verdict: 'good' | 'watch' | 'bad' | 'quiet'
  note: string
}

export type ErrorSummary = { code: string; count: number; meaning: string; last: string }

export type PhoneHealth = {
  checkedAt: string
  account: { name: string; type: string; status: string } | null
  concurrency: { cap: number; inFlightAtTwilio: number; queued: number; agentsLive: number; headroom: number }
  numbers: NumberHealth[]
  errors: ErrorSummary[]
  app: {
    activeSessions: { rep: string; startedAt: string; lastSeenAt: string; lines: number }[]
    stuckLegs: number
    lastConnectedAt: string | null
    connectedToday: number
    dialedToday: number
  }
  problems: string[]
  failures: string[]
}

const ERROR_MEANINGS: Record<string, string> = {
  '10004': 'Twilio rejected a call: the account concurrent-call cap is full.',
  '11200': 'Twilio could not reach our webhook (HTTP retrieval failure).',
  '11205': 'Our webhook took too long to answer (HTTP connection failure).',
  '12100': 'Our webhook returned invalid TwiML.',
  '13224': 'Invalid destination number.',
  '13227': 'Calling this country is disabled (geo permissions).',
  '21210': 'The caller ID is not owned or verified on this account.',
  '21217': 'Destination number not valid for this route.',
  '32014': 'Call dropped: no audio received from the callee (network timeout).',
  '32011': 'Call dropped: no audio received from the caller (network timeout).',
}

const twilioDate = (s: string | Date | null | undefined) => (s ? new Date(s).toISOString() : '')

export async function phoneHealth(): Promise<PhoneHealth> {
  const failures: string[] = []
  const problems: string[] = []
  const client = twilioClient()
  const admin = createAdminClient()
  const since = new Date(Date.now() - 7 * 86_400_000)
  const dayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')

  // --- Twilio account -------------------------------------------------------
  let account: PhoneHealth['account'] = null
  try {
    const a = await client.api.v2010.accounts(env.twilioAccountSid).fetch()
    account = { name: a.friendlyName, type: String(a.type), status: String(a.status) }
    if (String(a.type).toLowerCase() === 'trial') problems.push('Twilio account is still a trial: calls only reach verified numbers.')
  } catch (e) {
    failures.push(`Twilio account: ${(e as Error).message}`)
  }

  // --- Live concurrency -----------------------------------------------------
  let inFlightAtTwilio = 0
  let queued = 0
  try {
    const [ringing, inProgress, q] = await Promise.all([
      client.calls.list({ status: 'ringing', limit: 50 }),
      client.calls.list({ status: 'in-progress', limit: 50 }),
      client.calls.list({ status: 'queued', limit: 50 }),
    ])
    inFlightAtTwilio = ringing.length + inProgress.length
    queued = q.length
    if (queued > 0) problems.push(`${queued} call${queued === 1 ? '' : 's'} queued at Twilio right now (calls-per-second limit).`)
  } catch (e) {
    failures.push(`Twilio live calls: ${(e as Error).message}`)
  }

  // --- Per-number health over 7 days ----------------------------------------
  const pool = env.callerIds
  const numbers = new Map<string, NumberHealth>()
  for (const n of pool) {
    numbers.set(n, { number: n, inPool: true, voiceCapable: null, dialed: 0, answered: 0, noAnswer: 0, busy: 0, failed: 0, answerRate: null, verdict: 'quiet', note: '' })
  }
  try {
    const owned = await client.incomingPhoneNumbers.list({ limit: 100 })
    const ownedSet = new Set(owned.map((p) => p.phoneNumber))
    for (const p of owned) {
      const h = numbers.get(p.phoneNumber)
      if (h) h.voiceCapable = !!p.capabilities?.voice
    }
    for (const n of pool) {
      if (!ownedSet.has(n)) problems.push(`Caller ID ${n} is in TWILIO_CALLER_IDS but not owned by this Twilio account.`)
    }
  } catch (e) {
    failures.push(`Twilio numbers: ${(e as Error).message}`)
  }
  try {
    const calls = await client.calls.list({ startTimeAfter: since, limit: 3000 })
    for (const c of calls) {
      if (c.direction !== 'outbound-api' || !c.from) continue
      let h = numbers.get(c.from)
      if (!h) {
        h = { number: c.from, inPool: false, voiceCapable: null, dialed: 0, answered: 0, noAnswer: 0, busy: 0, failed: 0, answerRate: null, verdict: 'quiet', note: '' }
        numbers.set(c.from, h)
      }
      if (c.status === 'failed') {
        h.failed++
        continue
      }
      h.dialed++
      if (c.status === 'completed' && Number(c.duration) > 0) h.answered++
      else if (c.status === 'no-answer') h.noAnswer++
      else if (c.status === 'busy') h.busy++
    }
  } catch (e) {
    failures.push(`Twilio call history: ${(e as Error).message}`)
  }
  for (const h of numbers.values()) {
    h.answerRate = h.dialed ? h.answered / h.dialed : null
    if (h.dialed < 20) {
      h.verdict = 'quiet'
      h.note = 'Too few calls in 7 days to judge.'
    } else if (h.answerRate! < 0.12) {
      h.verdict = 'bad'
      h.note = 'Very low answer rate: likely labelled spam by carriers. Rest this number and register it.'
      problems.push(`Caller ID ${h.number} answers only ${Math.round(h.answerRate! * 100)}% of the time: probably spam-labelled.`)
    } else if (h.answerRate! < 0.22) {
      h.verdict = 'watch'
      h.note = 'Answer rate is slipping. Watch for a spam label.'
    } else {
      h.verdict = 'good'
      h.note = 'Healthy answer rate.'
    }
    if (h.voiceCapable === false) problems.push(`Caller ID ${h.number} is not voice-capable.`)
  }

  // --- Twilio errors, last 24h ----------------------------------------------
  const errors: ErrorSummary[] = []
  try {
    const alerts = await client.monitor.v1.alerts.list({ startDate: new Date(Date.now() - 86_400_000), limit: 500 })
    const byCode = new Map<string, { count: number; last: string }>()
    for (const a of alerts) {
      const cur = byCode.get(a.errorCode) ?? { count: 0, last: '' }
      cur.count++
      const at = twilioDate(a.dateCreated)
      if (at > cur.last) cur.last = at
      byCode.set(a.errorCode, cur)
    }
    for (const [code, v] of [...byCode.entries()].sort((a, b) => b[1].count - a[1].count)) {
      errors.push({ code, count: v.count, meaning: ERROR_MEANINGS[code] ?? 'See twilio.com/docs/errors/' + code, last: v.last })
    }
    const tenK = byCode.get('10004')
    if (tenK && Date.now() - new Date(tenK.last).getTime() < 3 * 3_600_000) {
      problems.push(`Twilio rejected ${tenK.count} calls in 24h for the concurrent-call cap (last ${new Date(tenK.last).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}).`)
    }
    const webhook = (byCode.get('11200')?.count ?? 0) + (byCode.get('11205')?.count ?? 0) + (byCode.get('12100')?.count ?? 0)
    if (webhook) problems.push(`Twilio could not use our webhooks ${webhook} time${webhook === 1 ? '' : 's'} in 24h. Check the deploy and APP_URL.`)
  } catch (e) {
    failures.push(`Twilio alerts: ${(e as Error).message}`)
  }

  // --- App side --------------------------------------------------------------
  const app: PhoneHealth['app'] = { activeSessions: [], stuckLegs: 0, lastConnectedAt: null, connectedToday: 0, dialedToday: 0 }
  try {
    const alive = new Date(Date.now() - 45_000).toISOString()
    const [{ data: sessions }, { data: profiles }, { count: stuck }, { data: lastConn }, { count: connToday }, { count: dialedToday }] = await Promise.all([
      admin.from('call_sessions').select('id, agent_id, started_at, last_seen_at').eq('status', 'active').gte('last_seen_at', alive),
      admin.from('profiles').select('id, full_name'),
      admin.from('calls').select('id', { count: 'exact', head: true }).in('status', ['dialing', 'ringing']).is('ended_at', null).lt('started_at', new Date(Date.now() - 60_000).toISOString()),
      admin.from('calls').select('started_at').eq('status', 'connected').order('started_at', { ascending: false }).limit(1),
      admin.from('calls').select('id', { count: 'exact', head: true }).eq('status', 'connected').gte('started_at', dayStart.toISOString()),
      admin.from('calls').select('id', { count: 'exact', head: true }).neq('status', 'canceled').gte('started_at', dayStart.toISOString()),
    ])
    const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]))
    for (const s of sessions ?? []) {
      const { count } = await admin.from('calls').select('id', { count: 'exact', head: true }).eq('session_id', s.id).in('status', ['dialing', 'ringing', 'connected']).is('ended_at', null)
      app.activeSessions.push({ rep: names.get(s.agent_id) ?? 'unknown', startedAt: s.started_at, lastSeenAt: s.last_seen_at, lines: count ?? 0 })
    }
    app.stuckLegs = stuck ?? 0
    app.lastConnectedAt = lastConn?.[0]?.started_at ?? null
    app.connectedToday = connToday ?? 0
    app.dialedToday = dialedToday ?? 0
    if (app.stuckLegs > 0) problems.push(`${app.stuckLegs} line${app.stuckLegs === 1 ? '' : 's'} have been "dialing" for over a minute with no word from Twilio.`)
  } catch (e) {
    failures.push(`Database: ${(e as Error).message}`)
  }

  const agentsLive = app.activeSessions.length
  const headroom = Math.max(0, TWILIO_CONCURRENT_CALLS - agentsLive - inFlightAtTwilio)

  return {
    checkedAt: new Date().toISOString(),
    account,
    concurrency: { cap: TWILIO_CONCURRENT_CALLS, inFlightAtTwilio, queued, agentsLive, headroom },
    numbers: [...numbers.values()].sort((a, b) => Number(b.inPool) - Number(a.inPool) || b.dialed - a.dialed),
    errors,
    app,
    problems,
    failures,
  }
}
