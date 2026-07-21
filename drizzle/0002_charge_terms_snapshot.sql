-- Purchased-terms snapshot on `charges` (lib/db/schema.ts → charges).
--
-- Apply this by hand against the Neon database: `npm run db:push` requires a TTY
-- and cannot be run from an agent session.
--
--   psql "$DATABASE_URL" -f drizzle/0002_charge_terms_snapshot.sql
--
-- Idempotent: safe to re-run.
--
-- WHY. The purchasable catalog became owner-editable at runtime (catalog_items),
-- but `charges` only froze the PRICE (`amount`) — the hours, validity and category
-- were re-resolved LIVE at approval time. A charge sitting in `awaiting_review`
-- while the owner edited its item would then be credited under the NEW terms:
-- edit p10 from 10h to 20h and the front desk grants 20 hours for a 5,500 THB
-- payment; edit it down and a customer who already paid is shortchanged, with
-- nothing in the ledger recording the mismatch (CLAUDE.md §8).
--
-- These columns freeze the terms the customer actually paid against, written at
-- every charge-creation site (createCheckout + both POS paths). Crediting reads
-- the snapshot; the live catalog item is used only for its display label.
--
-- NULLABLE ON PURPOSE: rows created before this migration carry no snapshot and
-- must stay valid. The credit paths fall back to the live catalog item for those,
-- exactly as they behaved before (lib/catalog/chargeTerms.ts → itemForCredit).
-- No backfill is possible or attempted — the terms those charges were sold under
-- were never recorded anywhere.

ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "hours" integer;
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "validity" text;
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "category" "package_category";
