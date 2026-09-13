# The Recruiting Line

One Next.js app for therecruitingline.com: the public marketing site and the
internal dialer/CRM, served from the same domain.

| Area | Routes | Code |
|------|--------|------|
| Marketing site | `/`, `/api/lead` | `app/(site)` |
| Dialer / CRM (sign-in required) | `/login`, `/leads`, `/crm`, `/dialer`, `/stats`, `/companies/[id]`, `/lead-list` | `app/(dialer)`, `components/`, `lib/`, `types/` |
| Dialer APIs | `/api/session/*`, `/api/calls/*`, `/api/recordings/*`, `/api/twilio/*` | `app/api` |
| Database | Supabase migrations | `supabase/migrations` |

The site and the dialer each have their own root layout (route groups), so the
dialer's Tailwind styles never touch the marketing page. `proxy.ts` puts only
the dialer routes behind Supabase sign-in; the **Login** link in the site's nav
goes to `/login`.

## Develop

```bash
npm install
cp .env.example .env.local   # Supabase, Twilio, Deepgram, Anthropic keys
npm run dev                  # http://localhost:3000
npm run build
npm run lint
```

The marketing site runs without any env vars. The dialer needs them; see
[docs/dialer.md](docs/dialer.md) for Supabase, Twilio and webhook setup.

## Deploy

Vercel project `recruitinglineweb`, connected to this repo. Pushing to `main`
deploys www.therecruitingline.com. `APP_URL` must be
`https://www.therecruitingline.com` and match the Twilio TwiML app's Voice URL.
