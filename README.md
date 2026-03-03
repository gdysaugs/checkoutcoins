# checkoutcoins

Game portal prototype with Supabase auth and point-based mini games.

## Pages output
- Static directory: `public`
- Functions directory: `functions`

## Required environment variables (Cloudflare Pages)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_30`
- `STRIPE_PRICE_ID_80`
- `STRIPE_PRICE_ID_200`
- `STRIPE_PRICE_ID_500`
- `STRIPE_PRICE_ID_1200`
- `STRIPE_SUCCESS_URL` (optional)
- `STRIPE_CANCEL_URL` (optional)

## API routes
- `GET /api/points/status`
- `POST /api/points/spend`
- `GET /api/stripe/checkout`
- `POST /api/stripe/checkout`
- `POST /api/stripe/webhook`

## Stripe webhook
- Endpoint: `https://checkoutcoins.uk/api/stripe/webhook`
- Event: `checkout.session.completed`
