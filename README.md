# RecruitingLine

A parallel dialer and CRM for recruiting outbound. Opens four lines at once,
connects you to whoever answers first, records the conversation, and files an
AI summary against the company record.

Next.js 16 (App Router) · Supabase (Postgres, Auth, Storage, Realtime) ·
Twilio Programmable Voice · Deepgram · Claude

---

## How the parallel dialer works

1. You start a session. Your browser joins a Twilio conference over WebRTC via
   the Voice SDK and waits there in silence.
2. The server reserves the next four eligible leads and their `calls` rows in a
   single transaction (`start_dial_batch`), then fires four outbound calls.
3. The first prospect to answer hits `/api/twilio/answer`, which runs an atomic
   compare-and-set in Postgres:

   ```sql
   update dial_batches set winner_call_id = $1
    where id = $2 and winner_call_id is null
   returning true;
   ```

   Exactly one webhook gets a row back no matter how close two answers land.
   The winner's TwiML bridges them into your conference; everyone else gets
   `<Hangup/>`.
4. The other legs are killed and dual-channel recording starts *after* the
   TwiML response is flushed, so the person who just said "hello" isn't
   listening to silence.
5. When the call ends, the exit interview blocks the next batch until you pick
   an outcome. The recording is archived, transcribed and summarized in the
   background and appears on the company page about a minute later.

Answering-machine detection runs in **async** mode: the call bridges
immediately and the machine/human verdict arrives a beat later. Synchronous AMD
would make every real human wait ~3 seconds in dead air.

---

## Setup

### 1. Supabase

Create a project, then run the migrations in order — `supabase db push`, or
paste each file into the SQL editor:

```
supabase/migrations/0001_init.sql          tables, enums, indexes
supabase/migrations/0002_logic_and_rls.sql rollups, dialer RPCs, RLS, storage
supabase/migrations/0003_realtime.sql      publish `calls` over Realtime
```

Create your team's users in **Authentication → Users**. The `on_auth_user_created`
trigger mirrors each one into `profiles`. To make someone a manager:

```sql
update profiles set role = 'manager' where email = 'you@example.com';
```

Copy the project URL and both keys from **Settings → API Keys** (the
*Publishable and secret API keys* tab, not the legacy anon/service_role tab).
The publishable key is safe in the browser because every query it makes runs
under RLS; the secret key bypasses RLS and is what the Twilio webhooks use to
write call rows with no user session.

### 2. Twilio

1. Buy voice-capable numbers — **at least as many as `DEFAULT_LINES_PER_BATCH`**.
   Each line in a batch dials from a different number, which avoids per-number
   outbound queueing (a four-line batch from one number rings seconds apart)
   and spreads volume so no single number absorbs all the spam-flagging risk.
   List them comma-separated in `TWILIO_CALLER_IDS`.
2. Create an **API Key** (Account → API keys) for softphone tokens.
3. Create a **TwiML App** with its Voice Request URL set to:
   `https://<your-domain>/api/twilio/softphone?s=<WEBHOOK_SECRET>`
   Use a *dedicated* app — pointing an existing one here breaks whatever else
   was using it.

### 3. Environment

```bash
cp .env.example .env.local     # then fill it in
openssl rand -hex 32           # WEBHOOK_SECRET
```

### 4. Webhooks in development

Twilio has to reach your machine. Start a tunnel and set `APP_URL` to it:

```bash
ngrok http 3000
```

Every webhook is verified twice — the `X-Twilio-Signature` HMAC *and* the `s`
query secret. The signature is checked against `APP_URL`, not the incoming
`Host` header, because a tunnel rewrites it.

### 5. Run

```bash
npm run dev
```

---

## Layout

```
app/(app)/crm             the CRM grid, inline editing, CSV import
app/(app)/companies/[id]  call history, recordings, AI summaries
app/(app)/dialer          the parallel dialer + exit interview
app/api/twilio/*          webhooks: answer (the race), status, amd, recording
app/api/session/*         start / batch fan-out / end
lib/twilio                REST client, signature verification, leg control
lib/ai/summarize.ts       archive → transcribe → structured summary
supabase/migrations       schema, RPCs, RLS
```

## Data model notes

- **`calls` is one row per dial**, winners and losers alike. Losing legs are
  `canceled` and excluded from `call_count`, `last_called_at` and the company
  page — the prospect never heard a ring, so counting it would misrepresent the
  relationship.
- **`companies.response` is derived**, not authored. A trigger recomputes it
  from the most recent dispositioned call, so the exit interview is the single
  place a disposition is written.
- **Recordings are dual-channel**: the prospect on one track, you on the other.
  That's what makes the transcript speaker-attributed without diarization
  guesswork, and it's why summary quality holds up.

## Things to know before you dial for real

- **Losing legs hang up silently** (`LOSING_LEG_BEHAVIOR` in `lib/constants.ts`).
  Prospects who answer a fraction of a second late hear dead air. Flipping the
  constant to `'whisper'` plays a brief apology instead — worth doing if numbers
  start getting spam-flagged or complaints appear.
- **Recording consent** is two-party in roughly eleven states. Put a disclosure
  in your opener.
- **Spam labeling**: a fresh Twilio number cold-calling at 4× volume gets
  flagged within days. The caller-ID pool spreads that load, but also verify
  your numbers for SHAKEN/STIR attestation and register with the Free Caller
  Registry.
- **Inbound calls are not handled.** The dialer is outbound only; a prospect
  who calls one of your numbers back currently reaches a Twilio error. Set a
  voice URL on each number when you're ready to take callbacks.
- **Calling hours** (8am–8pm prospect-local) are enforced from
  `companies.timezone`, derived from state on import. Unknown timezone is
  treated as dialable.
