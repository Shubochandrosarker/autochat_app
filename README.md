# AutoChat LiveAvatar App

This Next.js application embeds the ADHD LiveAvatar experience and connects it
to the WordPress/WooCommerce token service at `adhdtoolsdaily.com`.

## Local setup

1. Install Node.js 20 LTS or newer.
2. Run `npm ci` in the repository.
3. Create `.env.local` with server-only values:

```env
LIVEAVATAR_API_KEY=your_liveavatar_api_key
LIVEAVATAR_AVATAR_ID=513fd1b7-7ef9-466d-9af2-344e51eeb833
BILLING_API_BASE=https://adhdtoolsdaily.com/wp-json/adhd/v1
BILLING_API_BEARER=your_server_to_server_bearer
```

`LIVEAVATAR_API_KEY` and `BILLING_API_BEARER` must never be exposed in a
`NEXT_PUBLIC_*` variable or committed to Git. `NEXT_PUBLIC_BASE_API_URL` is
optional and is not used for provider authentication.

Run `npm run dev`, then open `http://localhost:3000/embed?token=PURCHASE_TOKEN`.
The purchase token is created by the WordPress plugin after a completed
WooCommerce order for product `1687`.

## Production contract

The production Vercel domain is:

`https://autochatapp-iota.vercel.app/`

The WordPress shortcode embeds `/embed?token=...` from that domain. The app
verifies the purchase on the server, mints a LiveAvatar session token, and
opens a server-side billing session. Every 15 seconds the app sends a heartbeat;
the WordPress ledger charges only elapsed server-observed seconds. Closing,
disconnecting, timeout, or exhaustion ends the ledger row. Client-side minute
decrement requests are not used.

## Validation

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Do not add GitHub Actions for this project. Deployment is performed through the
existing Vercel Git integration after a validated direct push to the production
branch.
