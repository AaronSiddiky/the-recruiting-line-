# The Recruiting Line

Monorepo for therecruitingline.com and the internal dialer/CRM, using npm workspaces.

| App | Path | What it is | Local | Production |
|-----|------|-----------|-------|------------|
| Web | `apps/web` | Marketing site, lead form (`/api/lead`), internal CSV lead browser (`/leads`) | http://localhost:3000 | https://www.therecruitingline.com |
| Dialer | `apps/dialer` | Parallel dialer + CRM (Supabase, Twilio, Deepgram, Claude) | http://localhost:3001 | https://app.therecruitingline.com |

The site's **Login** link goes to the dialer's `/login`. Override the target with
`NEXT_PUBLIC_DIALER_URL` (defaults to `http://localhost:3001` in dev and
`https://app.therecruitingline.com` in production).

## Getting started

```bash
npm install          # installs both apps from the repo root
npm run dev          # both apps
npm run dev:web      # just the site
npm run dev:dialer   # just the dialer (needs apps/dialer/.env.local, see apps/dialer/README.md)
npm run build        # build both
npm run lint
```

Always install from the root; there is a single `package-lock.json`.

## Deployment

Each app is its own Vercel project connected to this repo:

- `recruitinglineweb` → Root Directory `apps/web`
- `recruitingline` → Root Directory `apps/dialer`

A push to `main` deploys whichever app changed.
