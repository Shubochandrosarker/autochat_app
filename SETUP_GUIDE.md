# Production-aware setup guide

## Install

Use Node.js 20 LTS or newer, then run `npm ci` from the repository root.

## Environment variables

Set these in Vercel for Development, Preview, and Production as appropriate:

```env
LIVEAVATAR_API_KEY=your_liveavatar_api_key
LIVEAVATAR_AVATAR_ID=513fd1b7-7ef9-466d-9af2-344e51eeb833
BILLING_API_BASE=https://adhdtoolsdaily.com/wp-json/adhd/v1
BILLING_API_BEARER=your_server_to_server_bearer
```

The API key and bearer are server-only secrets. Do not place them in the
browser bundle, source code, screenshots, or Git history.

## Test locally

Run `npm run dev`, then open:

`http://localhost:3000/embed?token=PURCHASE_TOKEN`

Use a real purchase token only for an authorized test. The app verifies it
through WordPress, starts LiveAvatar, and records an active ledger session.
Heartbeats charge elapsed seconds on the server. Session end, timeout, and
exhaustion close the ledger entry.

## Release checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```

The repository is deployed by Vercel's existing Git connection after a direct
push to the configured production branch. GitHub Actions are intentionally not
used for this project.
