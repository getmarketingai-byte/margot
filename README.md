# Margot

AI-powered marketing cockpit for entrepreneurs.

## Tech stack

- **Framework:** Next.js 15 (App Router)
- **Auth:** Auth.js v5 + Google OAuth
- **Database:** Neon Postgres + Drizzle ORM
- **Queue:** Inngest
- **AI:** Claude API via @margot/marketing-engine

## Monorepo structure

```
apps/
  web/          # Next.js 15 main app
packages/
  schema/       # Drizzle schema + A2A types
  marketing-engine/  # AI marketing content generation
```

## Getting started

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
# Fill in env vars, then:
pnpm dev
```
