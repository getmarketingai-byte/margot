# Margot — AI Marketing Cockpit

AI-powered marketing assistant for Australian SMB entrepreneurs. Built on a
mobile-first SaaS foundation with energy-aware weekly planning that publishes
private iCal feeds.

Forked from `mlewis89/AppsScript_CalendarAutomations` and extended with:
- AI marketing agents (Google ADK + Gemini)
- A2A agent interoperability protocol
- Multi-tenant Postgres with RLS
- pgvector embeddings
- PWA (Workbox 7)
- Australian-market marketing engine

## Stack

- **Web**: Next.js 15 (App Router) + Tailwind, hosted on Vercel.
- **Auth**: Auth.js v5 with Google OAuth.
- **Database**: Postgres via Neon (ap-southeast-2) + pgvector + Drizzle ORM.
- **Background jobs**: Inngest, fanned out by Vercel Cron.
- **Billing**: Stripe Checkout + Customer Portal.
- **AI Agents**: Google ADK + Gemini, A2A protocol.
- **Planner**: pure-TS package (`packages/planner`).
- **Settings schema**: Zod-validated, versioned (`packages/schema`).
- **Marketing engine**: AU-market content calendar, outreach templates (`packages/marketing-engine`).

## Layout

```
apps/
  web/                     Next.js app (UI, API routes, jobs)
packages/
  schema/                  Zod UserSettings + WeeklyPlan + GeneratedEvent
  planner/                 Interval algebra, timemap, sleep, weekly allocator, ICS
  marketing-engine/        AU marketing content calendar, outreach templates, A2A agents
  mcp-server/              MCP server for calendar/planning tools
```

## Setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
# fill in DATABASE_URL, AUTH_SECRET, GOOGLE_CLIENT_ID/SECRET, INNGEST keys,
# STRIPE keys, TOKEN_ENCRYPTION_KEY (openssl rand -base64 32), CRON_SECRET
pnpm db:generate
pnpm db:migrate
pnpm dev
```

## Tests

```bash
pnpm test
```

## Deploying

Push to the `margot` Vercel project. Inngest endpoint: `/api/inngest`.
Stripe webhook: `/api/stripe/webhook`.
