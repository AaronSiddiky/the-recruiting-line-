# RecruitingLine — session handoff

Resume point for a fresh session. Delete once the schema is live.

## State: built and wired, blocked on one thing

The app is complete and verified. **The Supabase schema has not been applied.**
Nothing else is outstanding.

## Done and verified

- **Code**: CRM grid, company page, parallel dialer, exit interview, AI summary
  pipeline. `npx tsc --noEmit`, `npx eslint .`, `npm run build` all clean.
- **Schema**: migrations proven against a scratch Postgres. The four-way race on
  `claim_batch_winner` returns exactly one winner; the rollup trigger excludes
  losing legs from `call_count`.
- **Supabase**: URL + publishable + secret keys in `.env.local`, all verified by
  live API call. App boots against the project and redirects signed-out traffic.
- **Twilio**: account, API key, and a dedicated TwiML app
  (`AP566b96fb05d941c416ec581e8b9b1839`, "RecruitingLine dialer (dev)") verified
  live. Webhook signature validation proven through the tunnel — a request with
  the correct query secret but no HMAC is still rejected 403.
- **Caller ID pool**: four numbers in `TWILIO_CALLER_IDS`, one per line per batch.

## The one blocker

`public.companies` does not exist. Apply the three files in
`supabase/migrations/` in order. Any of:

- Supabase MCP (configured in `.mcp.json`, pre-approved in
  `.claude/settings.local.json`) — run `/mcp`, authenticate, then `apply_migration`
- `SUPABASE_ACCESS_TOKEN=sbp_... npx supabase@latest ...`
- Paste the SQL into the dashboard SQL editor

Verify afterwards with the secret key:

```bash
set -a; . ./.env.local; set +a
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/companies?select=id&limit=1" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY"
```

`[]` means it worked. `PGRST205` means it did not.

## Then

1. Create a user in Supabase Auth → the `on_auth_user_created` trigger mirrors
   it into `profiles`.
2. Import leads via the CRM's Import CSV, pointed at a number you control.
3. Start a dialing session and confirm: connect, record, exit interview,
   AI summary on the company page.

## Gotchas

- **The ngrok URL is ephemeral.** `APP_URL` in `.env.local` and the TwiML app's
  voice URL must match, or signature validation fails closed. Restarting ngrok
  means updating both.
- **Do not touch TwiML app `AP1fe1bd95…`** ("acquisitions power dialer") or the
  five other numbers on the account — they belong to acquisitions-crm and
  ElevenLabs.
- **Twilio auth token is in the chat transcript.** Rotate it if that transcript
  is ever shared; it is a one-line env change.
- `~/.claude/settings.json` has two hooks pointing at a missing `ahead-hook.js`
  and throws MODULE_NOT_FOUND on every session end. Harmless, unfixed.
