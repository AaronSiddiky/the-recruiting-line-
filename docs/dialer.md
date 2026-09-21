# RecruitingLine

A dialer and CRM for recruiting outbound. Calls one prospect at a time from
your own dedicated number, records the conversation, and files an AI summary
against the company record.

Next.js 16 (App Router) · Supabase (Postgres, Auth, Storage, Realtime) ·
Twilio Programmable Voice · Deepgram · Claude

---

## How the dialer works

1. You start a session. Your browser joins a Twilio conference over WebRTC via
   the Voice SDK and waits there in silence.
2. The server reserves the next eligible lead and its `calls` row in a single
   transaction (`start_dial_batch`), then places one outbound call from your
   number.
3. When the prospect answers, `/api/twilio/answer` claims the session's one
   live slot with an atomic compare-and-set in Postgres and bridges them into
   your conference. A leg that arrives late -- one Twilio held in its outbound
   queue, say -- does not get the slot and is hung up rather than dropped into
   a room where you are already talking to someone.
4. Dual-channel recording starts *after* the TwiML response is flushed, so the
   person who just said "hello" isn't listening to silence.
5. When the call ends, the exit interview blocks the next call until you pick
   an outcome. The recording is archived, transcribed and summarized in the
   background and appears on the company page about a minute later.

There is no answering-machine detection. It misjudged real people often enough
that it was removed; a voicemail greeting is a call the rep hangs up on and
dispositions like any other.

### Why not parallel dialing

It used to open four lines at once and bridge whoever answered first. Two
things killed it. Three of those four people picked up a call that hung up on
them, which is what gets numbers flagged as spam. And Twilio caps this account
at three concurrent calls, of which each rep's own softphone leg holds one all
session -- so a "four-line batch" was in practice one line, queued behind the
other rep.

## One number per rep

Each rep dials from one number, every time, set in `lib/twilio/caller-ids.ts`
or overridden with `TWILIO_NUMBER_BY_REP`. A prospect who has been called
before recognises the number instead of seeing a new one each time, and each
number's reputation belongs to one rep rather than being smeared across the
team. It also makes callbacks routable to the rep who dialled -- though
inbound calls are not handled yet (see below).

## The concurrent-call cap

Twilio's cap (error 10004) counts **calls, not caller IDs** — every live call
on the account, inbound and outbound, each rep's own softphone leg included. A
rep on a call therefore costs two slots: the prospect's leg and their own line.
Two reps need four.

The cap here is **4**, read off the account's own history rather than guessed:
over Sept 14–21 the account sustained 4 live calls 93 times and 5 only 10
times, while 188 of the 379 rejections arrived with 4 already live. It was set
to 3 for a while, which was simply wrong, and that is what made the two reps
take turns.

Four is exactly enough for both reps at once, with nothing spare — so the
budget hands each rep a **reserved share** of the cap rather than letting them
race for a pool (`repAllowance` in `lib/twilio/allowance.ts`, tested in
`allowance.test.ts`). With a pool, whoever asked first took the last slot and
the other rep watched "waiting for a free line" for the length of a call. With
a share each, neither can take the other's.

Because there is no headroom, a leg that outlives its call costs someone a
turn. If "waiting for a free line" starts showing up when nobody is on the
phone, look for `dialing`/`ringing` rows that never closed.

More reps, or any slack, needs a bigger cap: submit a Primary Customer Profile
in Trust Hub (Twilio lifts limited concurrency once it is approved) and raise
`TWILIO_CONCURRENT_CALLS`. Alternatively `lib/twilio/accounts.ts` reads a
second Twilio account from `TWILIO2_*` and maps reps to it by email, giving
each their own cap.

## One login per rep

Each rep must sign in with their own account. A session belongs to the
account that opened it; starting a new session under the same account is
treated as "the old window is gone" and tears the old session down. Two people
sharing a login therefore hang up each other's calls every time either presses
Start. Since migration 0017 the dialer refuses to do that while the other
session is still polling, and asks before taking over.

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

1. Buy one voice-capable number per rep. List them all comma-separated in
   `TWILIO_CALLER_IDS`, then assign one to each rep by email in
   `TWILIO_NUMBER_BY_REP`.
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
app/(dialer)/(app)/crm    the CRM grid, inline editing, CSV import
app/(dialer)/(app)/companies/[id] call history, recordings, AI summaries
app/(dialer)/(app)/dialer the dialer + exit interview
app/api/twilio/*          webhooks: answer, status, recording
app/api/session/*         start / next / end
lib/twilio                REST client, signature verification, leg control
lib/ai/summarize.ts       archive → transcribe → structured summary
supabase/migrations       schema, RPCs, RLS
```

## Data model notes

- **`calls` is one row per dial.** A leg that never reached the prospect is
  `canceled` and excluded from `call_count`, `last_called_at` and the company
  page — they never heard a ring, so counting it would misrepresent the
  relationship. These were common when four lines raced; they should be rare
  now, and a run of them means legs are outliving their session.
- **`companies.response` is derived**, not authored. A trigger recomputes it
  from the most recent dispositioned call, so the exit interview is the single
  place a disposition is written.
- **Recordings are dual-channel**: the prospect on one track, you on the other.
  That's what makes the transcript speaker-attributed without diarization
  guesswork, and it's why summary quality holds up.

## Things to know before you dial for real

- **Recording consent** is two-party in roughly eleven states. Put a disclosure
  in your opener.
- **Spam labeling**: a fresh Twilio number cold-calling all day gets flagged
  within days. One call at a time is a far gentler pattern than four, but also
  verify your numbers for SHAKEN/STIR attestation and register with the Free
  Caller Registry.
- **Inbound calls are not handled.** The dialer is outbound only; a prospect
  who calls one of your numbers back currently reaches a Twilio error. Set a
  voice URL on each number when you're ready to take callbacks.
- **Calling hours** (8am–8pm prospect-local) are enforced from
  `companies.timezone`, derived from state on import. Unknown timezone is
  treated as dialable.
