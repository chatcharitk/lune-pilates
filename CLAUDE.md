# LUNE Pilates — Project Guide

Single source of truth for everyone (humans + agents) building the real LUNE Pilates
application from the design handoff bundle under `lune-pilates/project/`.

---

## 1. What we're building

A boutique Pilates studio platform in Bangkok, **two surfaces, one backend**:

- **Customer app** — member & guest, **mobile, LINE-native** (runs as a LINE LIFF mini-app).
  Browse the week, book group/private/duo/trio/rental classes, manage shared household
  credits, buy packages via PromptPay, reschedule/cancel under policy, join waitlists.
- **Admin app** — front desk, **mobile-first but responsive** to iPad & desktop.
  Today-at-a-glance, schedule management (baseline → publish), bookings & waitlist control,
  customers/households, POS checkout, instructor availability & Gantt.

The **authoritative spec** is `lune-pilates/project/LUNE Product Spec.html` — read it top to
bottom. The visual prototypes are the other HTML/JSX files in that folder.

> The prototypes are **design medium**, not production code. Recreate their *visual output*
> pixel-faithfully in our real stack; do not copy their in-browser-Babel / `window.*` structure.

---

## 2. Tech stack (decided)

| Layer        | Choice                                                                 |
|--------------|------------------------------------------------------------------------|
| Framework    | **Next.js (App Router) + TypeScript**, single repo                     |
| UI           | **React + Tailwind CSS**, design tokens as CSS variables (see §4)       |
| Customer auth| **LINE LIFF** login (mocked in v1 behind an interface)                  |
| DB           | **Neon** serverless Postgres                                           |
| Data layer   | **Drizzle ORM** (explicit transactions for the ledger; swappable to Prisma) |
| Payments     | **PromptPay** (mocked in v1 behind an interface)                        |
| CRM/notify   | **LINE Messaging API** (mocked in v1 behind an interface)               |
| i18n         | Bilingual **EN / TH**, every user-facing string keyed (see §6)          |
| Deploy       | Vercel/Railway (one deploy)                                            |

**v1 scope = core first.** Build auth, households, credits/ledger, booking, schedule,
waitlist, and admin **for real**. LINE login, LINE messages, and PromptPay are **mocked
behind clean interfaces** so they can be swapped for real integrations later without touching
business logic.

### Neon + Drizzle transaction note
The atomic ledger debit needs a **real interactive transaction**. Neon's plain HTTP `neon()`
driver does not support interactive multi-statement transactions — use the **WebSocket `Pool`**
from `@neondatabase/serverless` and `drizzle(pool)`, then `db.transaction(async (tx) => { … })`.

---

## 3. Proposed repo structure (the real app lives here)

```
app/
  (customer)/        LINE LIFF customer routes
  (admin)/           admin routes (responsive)
  api/               route handlers (or server actions co-located)
components/          shared + per-surface UI
lib/
  db/                drizzle schema + client (Neon Pool)
  credits/           ledger + atomic debit (the money-critical core)
  schedule/          baseline templates, publish, tiered visibility
  waitlist/          queue + 30-min confirm hold
  line/              LINE adapter:  interface + mock impl (+ real later)
  payments/          PromptPay adapter: interface + mock impl
  i18n/              STR catalog (EN/TH), t()/tt() helpers
  events/            domain-event bus → CRM listeners (thin)
drizzle/             SQL migrations
```

---

## 4. Design system (canonical = the prototype's default "warm" theme)

Tokens are defined in `lune-pilates/project/lune-ui.jsx` (`themeVars`) and the spec's `:root`.
Reproduce them as CSS variables / Tailwind theme. **Extract exact values from the prototype**
when implementing; this table is the baseline:

```
--cream #F1E9E0   --cream-2 #E9DECF   --surface #FBF6EF   --surface-2 #FFFCF7
--ink #2E2820     --ink-soft #6B5D4C  --muted #9C8C77
--line rgba(140,122,99,0.16)          --line-strong rgba(140,122,99,0.30)
--taupe #8C7A63   --taupe-deep #6E5E49
--sage #8C9A7E    --sage-deep #6E7C60 --rose #C49A86      --blue #6E84A3
shadow-sm 0 1px 2px rgba(72,58,40,.04), 0 4px 14px rgba(72,58,40,.05)
shadow-md 0 4px 14px rgba(72,58,40,.06), 0 18px 40px rgba(72,58,40,.09)
radius (soft) 30px / radius-sm ~16px
```

Fonts: **brand** Cormorant Garamond (serif, the "LUNE" wordmark + accents) ·
**headings** Schibsted Grotesk · **body** Hanken Grotesk ·
**Thai** IBM Plex Sans Thai (+ Trirong for serif Thai). The wordmark "E" carries a small
4-point sparkle motif. Admin uses a parallel `--a-*` token namespace and a dark sidebar.

---

## 5. Core domain model & invariants (the logic that must be correct)

Entities (see spec §5): `Household`, `User(tier: member|guest, household_id?)`,
`Package(owner = household_id for members | user_id for guests; hours_total, hours_left, expires_at)`,
`CreditLedger(append-only: package_id, delta, actor_user_id, booking_id?, reason, created_at)`,
`ClassInstance(starts_at, type, capacity, instructor_id?, status, members_visible_at, public_visible_at)`,
`Booking`, `Waitlist`.

**Invariants — Quality Control audits against these; they are non-negotiable:**

1. **Atomic shared-credit debit.** Booking = ONE transaction: re-check `hours_left >= cost` AND
   `expires_at > now()`, insert a `−cost` ledger row stamped with `actor_user_id`, decrement
   `hours_left`, insert the booking — **all or nothing**. No double-debit, no booking without
   debit, no debit without booking. Concurrency-safe (row lock / serializable).
   **Credit cost per booking (decided 2026-07-04, supersedes 2026-06-17):** WHOLE-INTEGER
   credits — Group = 1, Rental = 1, Private/Duo/Trio = **2**. Balances/costs are `integer`
   columns — see §8. A first-ever paid purchase of the 1-hour drop-in grants +1 free trial
   hour (1+1 promo, ledger reason "promo").
2. **Household pool is shared & consistent.** Every member of a house number reads the same
   balance; one member's booking is immediately visible to the rest. Balance = derivable from
   the ledger (ledger is the truth; `hours_left` is a cache that must always reconcile).
3. **Guest packages never join a household** (`owner = user_id`) — non-transferable by construction.
4. **Tiered visibility is computed, not duplicated.** One `ClassInstance`. Bookable query:
   `status='published' AND starts_at > now() AND (viewer.tier='member' OR now() >= public_visible_at)`.
   `members_visible_at = published_at`; `public_visible_at = starts_at − N` (N tunable per type).
5. **Schedule edits are per-week, never mutate the recurring template.** The template is
   EDITABLE data (`class_templates`, admin "Manage template"; `BASELINE_SLOTS` is only the
   seed + empty-table fallback). Instances are **born published** (create/generate publish
   immediately — the separate publish step was removed 2026-07-04) and each publish-equivalent
   emits one broadcast event. A class can be **cancelled** (status `cancelled`): all live
   bookings refund, the waitlist expires without offers, and the class stops being bookable.
6. **Waitlist writes a Waitlist row, never a booking.** Joining is allowed only when the class is
   full; no charge. On a freed seat, offer the head of the queue a **30-minute window** to confirm
   and notify them; on timeout, cascade to the next head. The window is a FIFO **notification
   head-start, not a seat reservation** (decided 2026-06-19, "first to confirm wins"): the freed
   seat stays openly bookable, so confirming runs the normal atomic booking and may fail
   `CLASS_FULL` if a walk-up booked it first. No auto-charge — claiming debits only on confirm.
   Expiry + cascade run via a cron sweep (`/api/cron/waitlist-sweep`), with lazy expiry on read.
7. **Cancellation policy — FIXED window (decided 2026-06-28, supersedes 2026-06-19).** One
   fixed free-cancel window for every booking: a customer may cancel **only while ≥ 5h before
   class starts**, and that cancel refunds the **exact cost** booked (a `+cost` ledger row) —
   never a hardcoded 1. **Inside 5h, customer cancellation is blocked entirely** (no
   deduct-and-cancel path). `free_cancel_hours` is stamped 5 on every booking as an audit
   field only. **Customer reschedule was removed** (decided 2026-06-28) — all moves go through
   the front desk (`adminReschedule`, Owner-only, may bypass the window). Admin cancels are
   never window-blocked; the window only decides the DEFAULT refund, which the owner can
   override, and a class-level `cancelClass` refunds everyone regardless.
8. **Capacity.** Group/Trio/Rental cap 3, Duo cap 2, Private cap 1. Reformer max 3 per class.

**Automation/CRM** is a *thin listener* on domain events already in the model (publish,
booking insert, ledger change, waitlist offer, expiry sweep) — never a parallel source of truth.

Pricing/packages/schedule baseline are encoded in `lune-pilates/project/lune-data.jsx` — treat
that as the seed data + the spec's Pricing section as the canonical numbers.

---

## 6. i18n rules

- Every user-facing string is a key in the catalog with `{ en, th }`. No hardcoded copy in JSX.
- Helpers: `t(key)` for UI strings, `tt({en,th})` for content objects (mirror the prototype).
- Thai must render with the Thai font stack; layouts must not break on longer Thai strings.
- Currency: Thai Baht, `฿` prefix, `toLocaleString('en-US')` grouping (see `thb()` in the prototype).

---

## 7. The agent team

Three project subagents live in `.claude/agents/`. Use them deliberately:

- **`frontend-developer`** — builds the Next.js/React/Tailwind UI for both surfaces,
  pixel-faithful to the prototypes, bilingual, accessible. Consumes the backend's typed contracts.
- **`backend-developer`** — owns the Drizzle schema, the money-critical credit/ledger/booking
  logic, tiered visibility, waitlist holds, auth/session, API/server actions, and the
  mockable LINE/PromptPay/event adapters.
- **`quality-control`** (Audit) — **read-only**; independently verifies work against §5
  invariants, spec fidelity, design fidelity, i18n completeness, security, and a11y. Reports
  findings; does not fix (separation of duties).

Typical loop: backend builds a contract → frontend builds against it → quality-control audits →
devs address findings.

---

## 8. House rules

- TypeScript strict; no `any` in domain logic. **Credit balances and costs are whole-INTEGER
  columns (decided 2026-07-04, supersedes the 2026-06-17 `numeric(4,1)` decision)** — Group/Rental
  booking = 1, Private/Duo/Trio = 2. Keep all cost/refund math server-side. Never trust
  client-supplied balances or prices — recompute server-side.
- All business rules (debit, visibility, policy, capacity) enforced **server-side**; the client
  only renders and requests.
- Keep integration adapters behind interfaces so mock↔real is a one-file swap.
- Match the surrounding code's conventions; don't render prototypes in a browser unless asked.
