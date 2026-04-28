# Calendar Automations

Mobile-first SaaS for energy-aware weekly planning that publishes private iCal
feeds you subscribe to from any calendar app. Migration target for the legacy
single-tenant Apps Script project (`Code.gs` / `TimeMapBlocks.gs` / `Sleep.gs` /
`Travel.gs` / `Config.gs`).

## Stack

- **Web**: Next.js 15 (App Router) + Tailwind, hosted on Vercel.
- **Auth**: Auth.js v5 with Google OAuth (read-only Calendar scopes).
- **Database**: Postgres via Neon + Drizzle ORM.
- **Background jobs**: Inngest, fanned out by Vercel Cron.
- **Billing**: Stripe Checkout + Customer Portal.
- **Planner**: pure-TS package (`packages/planner`) ported from the GAS pipeline.
- **Settings schema**: Zod-validated, versioned (`packages/schema`).

## Layout

```
apps/
  web/              Next.js app (UI, API routes, jobs)
packages/
  schema/           Zod UserSettings + WeeklyPlan + GeneratedEvent
  planner/          Interval algebra, timemap bands, sleep, weekly allocator, ICS
```

The legacy Apps Script files remain at the repo root for reference; they are not
loaded by the web app and can be archived once parity is confirmed in production.

## Setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
# fill in DATABASE_URL, AUTH_SECRET, GOOGLE_CLIENT_ID/SECRET, INNGEST keys,
# STRIPE keys, TOKEN_ENCRYPTION_KEY (openssl rand -base64 32), CRON_SECRET
# generate SQL migration files in apps/web/drizzle/
pnpm db:generate
# apply SQL migrations from apps/web/drizzle/
pnpm db:migrate
pnpm dev
```

## Tests

```bash
pnpm test
```

Covers interval algebra, timemap band placement (sequential and cumulative
deep-work), the weekly allocator with framework tags, ICS rendering, and
settings schema migration.

## Frameworks supported

- **Bustamante-style energy ordering** — `hyperfocus` / `hyperaware` / `neutral`
  goal tags + ordering mode (`strict` / `balanced` / `ignore`).
- **Tony Robbins Wheel of Life** — eight default areas with 1-10 satisfaction
  scores and weekly minute floors.
- **Natalie Dawson PPF** — Personal / Professional / Financial pillars with
  optional `y1` / `y3` / `y5` horizons, percent-of-week and touches-per-week
  targets.
- **Brendon Burchard HP6 / HPP** — six habit tags + monthly minimum-touch goals
  + weekly review day + monthly strategy day-of-month.
- **Consistency segments** — recurring non-negotiable blocks reserved before
  goal allocation.

## Deploying

Push to a Vercel project; configure the env vars from `.env.example`. The Cron
schedule lives in `apps/web/vercel.json`. Stripe webhook endpoint:
`/api/stripe/webhook`. Inngest endpoint: `/api/inngest`.
