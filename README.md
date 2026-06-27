# LUNE Pilates

A boutique Pilates studio platform in Bangkok — two surfaces, one backend:

- **Customer app** — member & guest, mobile, LINE-native (LIFF mini-app): browse the
  week, book group/private/duo/trio/rental classes, manage shared household credits,
  buy packages via PromptPay (slip upload), reschedule/cancel under policy, join
  waitlists, invite housemates.
- **Admin app** — front desk, mobile-first but responsive: today-at-a-glance, schedule
  baseline → publish, bookings & waitlist control, customers/households, POS + payment
  verification, instructor availability, and a business-overview dashboard.

## Stack

Next.js (App Router) + TypeScript · React + Tailwind · Neon serverless Postgres +
Drizzle ORM (WebSocket Pool for the atomic credit ledger) · bilingual EN/TH.
LINE login, LINE messaging, PromptPay, and slip storage are **mocked behind clean
interfaces** in v1 (one-file swaps to real providers — all fail closed).

## Develop

```bash
npm install
cp .env.example .env     # point DATABASE_URL at your Neon pooled connection string
npm run db:push          # create the schema
npm run db:seed          # demo data (idempotent)
npm run dev
```

The app runs without a database too — every read model has a mock fallback, so
`npm run dev` with no `DATABASE_URL` renders the full UI on built-in demo data.

## Quality gates

```bash
npm run typecheck        # tsc --noEmit (strict)
npm test                 # unit suite (no DB needed)
npm run test:integration # money-path proofs against a real Neon DB
```

## Docs

- `CLAUDE.md` — architecture, the domain invariants (atomic credit debit, household
  pool, tiered visibility, waitlist, cancellation policy, capacity), and house rules.
- `DEPLOY.md` — env vars, database, cron, and the pre-launch checklist.
