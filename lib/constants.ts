import type { CallOutcome, CallStatus } from '@/types/db'

/** The four dispositions from the exit interview. Order is the UI order. */
export const CALL_OUTCOMES: {
  value: CallOutcome
  label: string
  hint: string
  /** Pressing this number in the exit interview selects it. */
  key: string
  tone: 'good' | 'bad' | 'neutral' | 'warn'
}[] = [
  {
    value: 'meeting_booked',
    label: 'Interested',
    hint: 'They want to hear more — shows up on the Interested tab',
    key: '1',
    tone: 'good',
  },
  {
    value: 'call_back',
    label: 'Call back',
    hint: 'Try again later — sets a follow-up date',
    key: '2',
    tone: 'warn',
  },
  {
    value: 'no_answer',
    label: 'No answer',
    hint: 'Voicemail or nobody there — queued again tomorrow',
    key: '3',
    tone: 'neutral',
  },
  {
    value: 'not_interested',
    label: 'Not interested',
    hint: 'Comes back around in a month',
    key: '4',
    tone: 'bad',
  },
  {
    value: 'wrong_number',
    label: 'Wrong number',
    hint: 'Bad data — removes them from the dial queue',
    key: '5',
    tone: 'neutral',
  },
  {
    value: 'customer',
    label: 'Became a customer',
    hint: 'They signed — counts toward customers on the stats page',
    key: '6',
    tone: 'good',
  },
  {
    value: 'not_hiring',
    label: 'Not hiring ATM',
    hint: 'No open seat right now — comes back in a month',
    key: '7',
    tone: 'warn',
  },
]

export const OUTCOME_LABELS: Record<CallOutcome, string> = Object.fromEntries(
  CALL_OUTCOMES.map((o) => [o.value, o.label]),
) as Record<CallOutcome, string>

export const STATUS_LABELS: Record<CallStatus, string> = {
  dialing: 'Dialing',
  ringing: 'Ringing',
  connected: 'Connected',
  no_answer: 'No answer',
  busy: 'Busy',
  failed: 'Failed',
  voicemail: 'Voicemail',
  canceled: 'Dropped',
}

/**
 * What a losing leg hears when it answers a fraction of a second too late.
 *
 * 'hangup'  — disconnect immediately (chosen default)
 * 'whisper' — brief apology, then disconnect
 *
 * Flipping this is the only change required; the answer webhook branches on it.
 * Worth knowing: 'hangup' means the prospect hears dead air, which is what
 * gets numbers flagged as spam and is what abandoned-call rules are about.
 */
export const LOSING_LEG_BEHAVIOR: 'hangup' | 'whisper' = 'hangup'

export const LOSING_LEG_WHISPER =
  "Sorry about that, we've got a bad connection. We'll try you back shortly."

/**
 * How many lines the dialer keeps out at once. The batch route trims this to
 * what Twilio's concurrent-call cap allows (see TWILIO_CONCURRENT_CALLS), so
 * asking for 4 under a cap of 4 yields 3 lines plus the rep's own leg.
 */
export const DEFAULT_LINES_PER_BATCH = Math.min(6, Math.max(1, Number(process.env.LINES_PER_BATCH) || 4))

/**
 * Twilio's concurrent-call cap for the whole account, agents' softphone legs
 * included. Measured at 3 on this account (Twilio's limited concurrency for
 * accounts without an approved Trust Hub business profile): across Sept 14-18
 * the most calls ever live at once was 3, and every batch that tried a 4th leg
 * got error 10004. The dialer never dials more lines than fit under it.
 *
 * Each rep's own line holds one slot for the whole session, so at 3 two reps
 * leave room for one prospect leg between them: they take turns. Raise
 * TWILIO_CONCURRENT_CALLS once Twilio lifts the cap.
 */
export const TWILIO_CONCURRENT_CALLS = Math.max(2, Number(process.env.TWILIO_CONCURRENT_CALLS) || 3)

/** Ring for this long before giving up on a leg. */
export const DIAL_TIMEOUT_SECONDS = 25


/** Local hours during which it is acceptable to dial a prospect. */
export const CALLING_HOURS = { start: 8, end: 20 } as const

/** Coarse state → IANA timezone map, enough to gate calling hours. */
export const STATE_TIMEZONES: Record<string, string> = {
  AK: 'America/Anchorage', AL: 'America/Chicago',    AR: 'America/Chicago',
  AZ: 'America/Phoenix',   CA: 'America/Los_Angeles', CO: 'America/Denver',
  CT: 'America/New_York',  DC: 'America/New_York',   DE: 'America/New_York',
  FL: 'America/New_York',  GA: 'America/New_York',   HI: 'Pacific/Honolulu',
  IA: 'America/Chicago',   ID: 'America/Boise',      IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis', KS: 'America/Chicago', KY: 'America/New_York',
  LA: 'America/Chicago',   MA: 'America/New_York',   MD: 'America/New_York',
  ME: 'America/New_York',  MI: 'America/Detroit',    MN: 'America/Chicago',
  MO: 'America/Chicago',   MS: 'America/Chicago',    MT: 'America/Denver',
  NC: 'America/New_York',  ND: 'America/Chicago',    NE: 'America/Chicago',
  NH: 'America/New_York',  NJ: 'America/New_York',   NM: 'America/Denver',
  NV: 'America/Los_Angeles', NY: 'America/New_York', OH: 'America/New_York',
  OK: 'America/Chicago',   OR: 'America/Los_Angeles', PA: 'America/New_York',
  RI: 'America/New_York',  SC: 'America/New_York',   SD: 'America/Chicago',
  TN: 'America/Chicago',   TX: 'America/Chicago',    UT: 'America/Denver',
  VA: 'America/New_York',  VT: 'America/New_York',   WA: 'America/Los_Angeles',
  WI: 'America/Chicago',   WV: 'America/New_York',   WY: 'America/Denver',
}

/**
 * The stats page ignores calls before this instant. Bump it to "reset" the
 * numbers without touching call history; the CRM and company pages still
 * show every call.
 */
export const STATS_SINCE = '2026-09-13T23:36:08Z'

/**
 * Calls before this instant count every dialed line that rang (the original
 * method); calls from this instant on count one per logged outcome. Keeps the
 * totals reps had already earned when the counting rule changed.
 */
export const STATS_OUTCOME_SINCE = '2026-09-15T18:06:55Z'
