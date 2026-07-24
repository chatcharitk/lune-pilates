# LUNE Pilates — Deploy Runbook

How to stand up the app on a fresh environment (Vercel + Neon). v1 ships the core
for real. LINE login and messaging, and PromptPay QR generation, are **mockable
behind interfaces** (see CLAUDE.md §2) — real PromptPay QR generation is now
available (§5b; still no automatic payment *verification*, see there).

---

## 1. Environment variables

Copy `.env.example` → `.env` (local) or set these in the Vercel project. Required:

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | **yes** | Neon **pooled** connection string (`…-pooler.…neon.tech`). The credit ledger uses interactive transactions over the WebSocket `Pool` driver — the pooled URL is mandatory. |
| `CRON_SECRET` | **yes (prod)** | Shared secret for `/api/cron/waitlist-sweep`. The route **fails closed (503)** if unset. Set it in Vercel and Vercel Cron sends it as `Authorization: Bearer <secret>` automatically. |
| `PAYMENTS_MODE` | no | `mock` (default) or `live`. **`live` = a real, scannable PromptPay QR** against `PROMPTPAY_ID` — see §5b. Throws at construction if `PROMPTPAY_ID` is missing/malformed (fail closed). |
| `PROMPTPAY_ID` | **yes when `PAYMENTS_MODE=live`** | The studio's PromptPay proxy: a 10-digit mobile number, 13-digit national/tax ID, or 15-digit e-Wallet ID. This is a real financial identifier — set it directly in Vercel, never commit it. |
| `LINE_MODE` | no | `mock` (default) or `live`. Same fail-closed behavior. |
| `STORAGE_MODE` | no | `mock` (default), `blob`, or `r2`. The slip-image store for PromptPay verification. `mock` persists the slip as a base64 data-URL in the DB; `blob` uses **Vercel Blob** and `r2` uses **Cloudflare R2** — for both, slip bytes live in the object store (not the DB) and are served only server-side via the owner-gated `getSlip`, so the PII image never reaches the client. Any other value **throws** (fail closed). |
| `BLOB_READ_WRITE_TOKEN` | only if `STORAGE_MODE=blob` | Vercel Blob read/write token. Auto-injected by Vercel when you create a Blob store; set manually only for local `blob` testing. Construction throws if `STORAGE_MODE=blob` and this is missing. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | only if `STORAGE_MODE=r2` | Cloudflare R2 credentials. In the Cloudflare dashboard: create an R2 bucket, then **R2 → Manage API tokens → Create S3 API token** (Object Read & Write) to get the access key id + secret. `R2_ACCOUNT_ID` is the id in the S3 endpoint `https://<id>.r2.cloudflarestorage.com`. Keep the bucket **private** (no public access / custom domain). All four are required; a missing one throws at startup. |
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
a shared group pool, a published week of group classes, and instructor availability.

> ⚠️ **Do NOT run the full seed against a database serving real customers** — it
> plants the DEMO member "Pim" with free spendable credits (and today's mock session
> resolves every visitor to that identity). Before real launch: split reference data
> (instructors, template) from demo data, and delete the demo household/member/package
> rows from prod. Tracked as a Phase-2 launch task.

---

## 3. Cron — waitlist hold sweep

`vercel.json` schedules `/api/cron/waitlist-sweep`. To activate:

1. Set `CRON_SECRET` in the Vercel project (Vercel Cron auto-sends it as a Bearer token).
2. Deploy. Vercel registers the cron from `vercel.json`.

Notes:
- **Schedule is daily (`0 3 * * *`) for Hobby-plan compatibility** — Hobby rejects any
  cron that runs more than once/day. On **Vercel Pro**, change it back to `*/5 * * * *`
  (every 5 min) for fresher waitlist cascades.
- ⚠️ **A daily sweep is NOT enough for real customers.** Reads lazily self-expire the
  *display* of a lapsed 30-min offer, but the **cascade to the next person in the queue
  runs only inside the sweep** (or on another freed seat). With a daily cron, person #2
  can wait ~24h for their turn. **Before launch**: either Vercel Pro `*/5 * * * *` or a
  free external scheduler (e.g. cron-job.org) hitting the route every 5 minutes.
- External scheduler calls: `GET`/`POST` the route with the secret as
  `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <secret>` (headers ONLY —
  the query-param form was removed so secrets never land in request logs).

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
- [ ] Confirm `LINE_MODE` is `mock` or ready for `live` per its own rollout.
- [ ] **Enable real PromptPay QR generation:** set `PAYMENTS_MODE=live` and `PROMPTPAY_ID`
      (see §5b). Until this is done, checkout renders the `MOCKPROMPTPAY` placeholder.
- [ ] Decide `ADMIN_AUTH`: keep the mock only behind a locked-down URL, or wire a real
      staff provider in `lib/auth/admin.ts` before the admin app is publicly reachable.
- [ ] (Pro plan) verify sub-daily cron is permitted; otherwise rely on lazy expiry +
      a manual/external sweep.

## 5b. Real PromptPay QR (PAYMENTS_MODE=live)

Generates an authentic, scannable PromptPay QR against the studio's own account —
no bank/gateway integration is needed for this part: a PromptPay QR is an
offline-computable EMVCo standard (`lib/payments/promptpay.ts`), not an API call.
Verified during development against a real bank-issued QR (the CRC-16 this app
computes matches the one a real banking app computed for the same account, byte
for byte — see `tests/promptpay-payload.test.ts`).

To turn it on:

1. Set `PAYMENTS_MODE=live` and `PROMPTPAY_ID` (the studio's mobile number,
   national/tax ID, or e-Wallet ID) in the environment.
2. Deploy. `/buy` and the admin POS PromptPay path now render a real, amount-locked
   QR instead of the `MOCKPROMPTPAY` placeholder.

**What this does NOT do — read before enabling:** it does not verify payment.
There is no bank webhook or payment-gateway API wired (a real one — Omise, GB Prime
Pay, 2C2P, a bank merchant API — needs merchant onboarding, KYC, and per-transaction
fees; explicitly out of v1 scope). Two flows use PromptPay, and only one depends on
this distinction:

- **Customer self-checkout** (`/buy`) is unaffected either way — its money gate is
  the customer's uploaded transfer slip + admin photo review (Feature 3), which
  never asks the payment provider whether a charge is "paid".
- **Admin POS PromptPay** (a walk-in sale) has the front desk press **Confirm**
  after visually checking the transfer landed in the studio's own banking app —
  the same trust level as a cash sale (also credited on the front desk's word,
  with no independent verification). `lib/payments/real.ts` documents this
  explicitly: `getStatus()` always resolves "paid" because there is no gateway to
  ask, and that is a deliberate, reviewed trade-off, not an oversight.

If a real payment gateway is integrated later, replace `getStatus()` in
`lib/payments/real.ts` with a genuine webhook/API check.

## 6. Post-v1 integration swaps (out of v1 scope)

Each is a one-file swap behind its interface — no business-logic change:
- **LINE LIFF login** → replace the mock identity in `lib/auth/session.ts`.
- **LINE Messaging** → implement the `live` branch in `lib/line/index.ts`.
- **A real PromptPay payment gateway** (automatic payment verification, replacing
  the manual confirm described in §5b) → replace `getStatus()` in
  `lib/payments/real.ts` with a genuine webhook/API integration.
