-- Structured validity snapshot on `charges` (lib/db/schema.ts → charges).
--
-- Apply this by hand against the Neon database (db:push needs a TTY):
--
--   psql "$DATABASE_URL" -f drizzle/0004_charge_validity_structured.sql
--
-- Idempotent: safe to re-run.
--
-- WHY. Completes the purchased-terms snapshot (0002) for the new structured validity
-- ({ amount, unit }, 2026-07-23). Every charge-creation site now writes BOTH the
-- legacy `validity` text AND these two columns. Crediting prefers the structured
-- columns and falls back to the legacy text when they are null (old rows) —
-- lib/catalog/chargeTerms.ts → itemForCredit.
--
-- NULLABLE ON PURPOSE: charges created before this migration carry no structured
-- snapshot and must stay valid; they fall back to the legacy text (or, for pre-0002
-- rows, to the live catalog item). No backfill is attempted.

ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "validity_amount" integer;
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "validity_unit" text;

-- Backfill from the legacy snapshot text where a snapshot exists but the structured
-- columns don't (0002 rows). Guarded so re-running never clobbers app-written values.
UPDATE "charges"
SET "validity_amount" = CASE "validity"
      WHEN 'single_visit'  THEN 1
      WHEN 'one_month'     THEN 1
      WHEN 'two_months'    THEN 2
      WHEN 'three_months'  THEN 3
      ELSE 1
    END,
    "validity_unit" = 'month'
WHERE "validity" IS NOT NULL AND "validity_amount" IS NULL;
