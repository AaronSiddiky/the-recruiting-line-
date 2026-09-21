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
 * Twilio's concurrent-call cap for the whole account (error 10004). It counts
 * every live call, inbound and outbound, each rep's own softphone leg
 * included.
 *
 * Measured from the account's own history rather than guessed: over Sept
 * 14-21 the account sustained 4 live calls 93 times and 5 only 10 times, while
 * 188 of the 379 rejections came with 4 already live. So 4 holds and the 5th
 * is refused.
 *
 * Four is exactly what two reps need: each rep on a call costs two slots, the
 * prospect's leg and their own. `availableLines` reserves each rep their half
 * so one cannot take the other's, which is what lets both dial at once.
 *
 * This used to be 3, which was wrong -- it left one prospect leg between two
 * reps and made them take turns.
 *
 * 4 is a floor, not just a default: a stale TWILIO_CONCURRENT_CALLS=3 left in
 * a deployment's environment would silently bring the turn-taking back, and
 * the symptom ("waiting for a free line") looks like a bug in the dialer
 * rather than a config value nobody remembers setting. A larger value from the
 * environment still wins -- raise it once a Trust Hub Primary Customer Profile
 * is approved and Twilio lifts limited concurrency. If Twilio ever throttles
 * this account below 4, lower the floor here rather than in the environment,
 * because below 4 two reps cannot both hold a call and that is worth seeing in
 * the diff.
 */
export const TWILIO_CONCURRENT_CALLS = Math.max(4, Number(process.env.TWILIO_CONCURRENT_CALLS) || 4)

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

/**
 * What a call to a technician can end in. Distinct from CALL_OUTCOMES, which
 * is about a company's open seat. Each maps onto a `call_outcome` for the call
 * row, a pipeline stage for the tech, and when to ring them next.
 */
export const TECH_OUTCOMES: {
  value: string
  label: string
  hint: string
  key: string
  tone: 'good' | 'bad' | 'neutral' | 'warn'
  /** Stored on the call row. */
  callOutcome: CallOutcome
  /** Moves the tech here, unless they are already further along. */
  stage: 'screened' | 'interviewing' | 'contacting' | 'rejected' | 'placed'
  /** Days until the next touch; null means "ask for a date". */
  followUpDays: number | null
}[] = [
  {
    value: 'interested',
    label: 'Interested in work',
    hint: 'Wants to hear about openings — moves to Screened',
    key: '1',
    tone: 'good',
    callOutcome: 'meeting_booked',
    stage: 'screened',
    followUpDays: 7,
  },
  {
    value: 'book_interview',
    label: 'Booked a tech interview',
    hint: 'Set the time below — moves to Tech interviews',
    key: '2',
    tone: 'good',
    callOutcome: 'meeting_booked',
    stage: 'interviewing',
    followUpDays: 7,
  },
  {
    value: 'call_back',
    label: 'Call back',
    hint: 'Busy now — pick a day',
    key: '3',
    tone: 'warn',
    callOutcome: 'call_back',
    stage: 'contacting',
    followUpDays: null,
  },
  {
    value: 'no_answer',
    label: 'No answer',
    hint: 'Voicemail or nobody there — try again tomorrow',
    key: '4',
    tone: 'neutral',
    callOutcome: 'no_answer',
    stage: 'contacting',
    followUpDays: 1,
  },
  {
    value: 'has_job',
    label: 'Happy where they are',
    hint: 'Working and not looking — back in a month',
    key: '5',
    tone: 'warn',
    callOutcome: 'not_hiring',
    stage: 'contacting',
    followUpDays: 30,
  },
  {
    value: 'not_interested',
    label: 'Not interested',
    hint: 'Done with us — out of the queue',
    key: '6',
    tone: 'bad',
    callOutcome: 'not_interested',
    stage: 'rejected',
    followUpDays: null,
  },
  {
    value: 'wrong_number',
    label: 'Wrong number',
    hint: 'Bad data — out of the queue',
    key: '7',
    tone: 'neutral',
    callOutcome: 'wrong_number',
    stage: 'rejected',
    followUpDays: null,
  },
  {
    value: 'placed',
    label: 'Placed',
    hint: 'Starting with a client — counts on the stats page',
    key: '8',
    tone: 'good',
    callOutcome: 'customer',
    stage: 'placed',
    followUpDays: null,
  },
]
