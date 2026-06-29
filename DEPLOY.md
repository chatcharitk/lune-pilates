# LUNE Pilates — Deploy Runbook

How to stand up the app on a fresh environment (Vercel + Neon). v1 ships the core
for real; LINE login, LINE messaging, and PromptPay are **mocked behind interfaces**
(see CLAUDE.md §2) and are swapped for real providers post-v1.

---

## 1. Environment variables

Copy `.env.example` → `.env` (local) or set these in the Vercel project. Required:

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | **yes** | Neon **pooled** connection string (`…-pooler.…neon.tech`). The credit ledger uses interactive transactions over the WebSocket `Pool` driver — the pooled URL is mandatory. |
| `CRON_SECRET` | **yes (prod)** | Shared secret for `/api/cron/waitlist-sweep`. The route **fails closed (503)** if unset. Set it in Vercel and Vercel Cron sends it as `Authorization: Bearer <secret>` automatically. |
| `PAYMENTS_MODE` | no | `mock` (default) or `live`. `live` **throws at construction** until a real PromptPay provider is wired — production can never silently run on the always-paid mock. |
| `LINE_MODE` | no | `mock` (default) or `live`. Same fail-closed behavior. |
| `STORAGE_MODE` | no | `mock` (default) or `blob`. The slip-image store for PromptPay verification. `mock` persists the slip as a base64 data-URL in the DB; `blob` uses **Vercel Blob** (slip bytes live in Blob, served only server-side via the owner-gated `getSlip` — the PII image URL never reaches the client) and requires `BLOB_READ_WRITE_TOKEN`. Any other value **throws** (fail closed). |
| `BLOB_READ_WRITE_TOKEN` | only if `STORAGE_MODE=blob` | Vercel Blob read/write token. Auto-injected by Vercel when you create a Blob store; set manually only for local `blob` testing. Construction throws if `STORAGE_MODE=blob` and this is missing. |
| `ADMIN_AUTH` | no | Unset = v1 mock admin (always grants a session). `deny` = reject all (locked-down staging). Swap in a real staff provider before exposing the admin app. |
| `ADMIN_ROLE` | no | Mock admin role: unset/`owner` = full admin; `instructor` = Today (own classes) + check-in only. `ADMIN_INSTRUCTOR_ID` (default `mai`) is the linked instructor slug when `instructor`. Real staff auth supplies the role later. |
| `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LIFF_ID` | only if `LINE_MODE=live` | LINE channel credentials. |

---

## 2. Database

The schema in `lib/db/schema.ts` is the **single source of truth**. The project is
`db:push`-driven — there are **no SQL migration files** to maintain.

```bash
npm run db:push    # create/sync all tables, indexes, constraints from schema.ts
npm run db:seed    # populate reference + demo data (idempotent — safe to re-run)
```

`db:push` reproduces everything from `schema.ts`, including the
`instructor_availability` and `payment_slips` tables, the integer credit columns,
the `credit_ledger.idempotency_key` partial-unique index (manual adjustments), and
the `bookings` one-live-per-(class,user) / per-position partial unique indexes.

> Note: `db:push` is interactive (prompts on ambiguous diffs) and needs a TTY. Run it
> from a local terminal against the target `DATABASE_URL`, not from CI.

`db:seed` creates 3 instructors (+ weekly availability), household A-114, member Pim,
a 7.5h shared group pool, a published week of group classes, and instructor availability.

---

## 3. Cron — waitlist hold sweep

`vercel.json` schedules `/api/cron/waitlist-sweep`. To activate:

1. Set `CRON_SECRET` in the Vercel project (Vercel Cron auto-sends it as a Bearer token).
2. Deploy. Vercel registers the cron from `vercel.json`.

Notes:
- **Schedule is daily (`0 3 * * *`) for Hobby-plan compatibility** — Hobby rejects any
  cron that runs more than once/day. On **Vercel Pro**, change it back to `*/5 * * * *`
  (every 5 min) for fresher waitlist cascades.
- The hold is 30 min and reads **lazily self-expire**, so a daily sweep is only a
  backstop — offers still expire on read and the queue still works between runs.
- An external scheduler works too (e.g. every 5 min on a free cron service): `GET`/`POST`
  the route with the secret as `Authorization: Bearer <CRON_SECRET>`, `x-cron-secret:
  <secret>`, or `?secret=<secret>`.

---

## 4. Build & verify

```bash
npm run typecheck        # tsc --noEmit (strict)
npm test                 # unit suite (no DB needed; mock path)
npm run test:integration # real-DB suite (needs DATABASE_URL); proves the atomic
                         # ledger, idempotency, visibility & policy against Postgres
npm run build            # next build
```

---

## 5. Pre-launch checklist (action required before go-live)

- [ ] **Rotate the Neon credential.** The dev `.env` has contained a real Neon password
      in plaintext on disk. It is gitignored, but rotate it before launch as a precaution
      and keep only `.env.example` (placeholders) in the repo.
- [ ] Set `CRON_SECRET` (random, ≥32 chars) in Vercel; confirm the cron runs (check logs).
- [ ] Confirm `PAYMENTS_MODE`/`LINE_MODE` are `mock` for v1 (they fail closed otherwise).
- [ ] Decide `ADMIN_AUTH`: keep the mock only behind a locked-down URL, or wire a real
      staff provider in `lib/auth/admin.ts` before the admin app is publicly reachable.
- [ ] (Pro plan) verify sub-daily cron is permitted; otherwise rely on lazy expiry +
      a manual/external sweep.

## 6. Post-v1 integration swaps (out of v1 scope)

Each is a one-file swap behind its interface — no business-logic change:
- **LINE LIFF login** → replace the mock identity in `lib/auth/session.ts`.
- **LINE Messaging** → implement the `live` branch in `lib/line/index.ts`.
- **PromptPay** → implement the `live` branch in `lib/payments/index.ts`.
