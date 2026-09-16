// Hand-written to match supabase/migrations. Once the project is linked you
// can replace this with `supabase gen types typescript --linked > types/db.ts`.

export type CallOutcome =
  | 'meeting_booked'
  | 'not_interested'
  | 'wrong_number'
  | 'call_back'
  | 'customer'
  | 'no_answer'
  | 'not_hiring'

export type CallStatus =
  | 'dialing'
  | 'ringing'
  | 'connected'
  | 'no_answer'
  | 'busy'
  | 'failed'
  | 'voicemail'
  | 'canceled'

export type UserRole = 'rep' | 'manager' | 'admin'

export type AiStatus = 'none' | 'pending' | 'processing' | 'ready' | 'failed'

/** Shape of `calls.ai_summary`. Produced by the summarizer, read by the UI. */
export type AiSummary = {
  headline: string
  summary: string
  objections: string[]
  commitments: string[]
  suggested_outcome: CallOutcome | null
  next_step: string | null
}

export type Profile = {
  id: string
  full_name: string
  email: string | null
  role: UserRole
  /** Storage path of the rep's pre-recorded voicemail message, if any. */
  voicemail_path: string | null
  created_at: string
}

export type Company = {
  id: string
  name: string
  city: string | null
  state: string | null
  /** E.164. Null for a lead nobody has a number for yet; the dialer skips those. */
  phone: string | null
  owner_id: string | null
  response: CallOutcome | null
  call_count: number
  last_called_at: string | null
  next_follow_up: string | null
  notes: string
  do_not_call: boolean
  timezone: string | null
  /** Where the lead came from, free text (e.g. "Google Maps", "Referral"). */
  source: string | null
  /** True once anyone has contacted them. Set by the first real call, or by hand. */
  reached_out: boolean
  /** Contact email, usually captured in the exit interview. */
  email: string | null
  /** Dial before everything else. Cleared automatically once dialed. */
  priority: boolean
  created_at: string
  updated_at: string
}

export type CallSession = {
  id: string
  agent_id: string
  conference_name: string
  lines_per_batch: number
  status: 'active' | 'ended'
  started_at: string
  ended_at: string | null
  /** Refreshed by the dialer's polling while the tab is open. */
  last_seen_at: string
}

export type DialBatch = {
  id: string
  session_id: string
  seq: number
  winner_call_id: string | null
  created_at: string
  resolved_at: string | null
}

export type SpotifyToken = {
  user_id: string
  access_token: string
  refresh_token: string
  expires_at: string
  scope: string | null
  display_name: string | null
  updated_at: string
}

export type ClientStatus = 'active' | 'paused' | 'ended'
export type TouchChannel = 'call' | 'email' | 'text' | 'meeting' | 'other'

/** A company that signed. Contract terms, who won it, and the contact. */
export type Client = {
  id: string
  company_id: string
  won_by: string | null
  status: ClientStatus
  contact_name: string | null
  contact_title: string | null
  contact_email: string | null
  contact_phone: string | null
  signed_at: string | null
  fee_cents: number | null
  fee_note: string | null
  guarantee_days: number | null
  payment_terms: string | null
  role_brief: string | null
  contract_path: string | null
  notes: string
  created_at: string
  updated_at: string
}

export type ClientTouchpoint = {
  id: string
  client_id: string
  user_id: string | null
  at: string
  channel: TouchChannel
  summary: string
  next_follow_up: string | null
  created_at: string
}

export type Call = {
  id: string
  company_id: string
  agent_id: string | null
  session_id: string | null
  batch_id: string | null
  call_sid: string | null
  status: CallStatus
  amd_result: string | null
  outcome: CallOutcome | null
  notes: string | null
  started_at: string
  answered_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  recording_sid: string | null
  recording_path: string | null
  recording_duration: number | null
  /** Set when the rep dropped their pre-recorded message into this call. */
  voicemail_left_at: string | null
  transcript: string | null
  ai_summary: AiSummary | null
  ai_status: AiStatus
  ai_error: string | null
  created_at: string
  updated_at: string
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>
      companies: Table<
        Company,
        Omit<
          Company,
          | 'id'
          | 'response'
          | 'call_count'
          | 'last_called_at'
          | 'created_at'
          | 'updated_at'
          | 'source'
          | 'reached_out'
          | 'email'
          | 'priority'
        > &
          Partial<Pick<Company, 'id' | 'notes' | 'do_not_call' | 'source' | 'reached_out' | 'email' | 'priority'>>
      >
      call_sessions: Table<CallSession>
      spotify_tokens: Table<SpotifyToken>
      clients: Table<Client>
      client_touchpoints: Table<ClientTouchpoint>
      dial_batches: Table<DialBatch>
      calls: Table<Call>
    }
    Views: Record<string, never>
    Functions: {
      start_dial_batch: {
        Args: { p_session: string; p_agent: string; p_limit?: number }
        Returns: {
          call_id: string
          batch_id: string
          company_id: string
          company_name: string
          phone: string
        }[]
      }
      claim_batch_winner: {
        Args: { p_batch_id: string; p_call_id: string }
        Returns: boolean
      }
      is_privileged: { Args: Record<string, never>; Returns: boolean }
    }
    Enums: {
      call_outcome: CallOutcome
      call_status: CallStatus
      user_role: UserRole
    }
    CompositeTypes: Record<string, never>
  }
}

/** A company row joined with its owner, as the CRM table renders it. */
export type CompanyRow = Company & {
  owner: Pick<Profile, 'id' | 'full_name'> | null
}
