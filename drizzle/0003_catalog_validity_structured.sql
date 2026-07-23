-- Structured validity on `catalog_items` (lib/db/schema.ts → catalogItems).
--
-- Apply this by hand against the Neon database (db:push needs a TTY, unavailable in
-- an agent session):
--
--   psql "$DATABASE_URL" -f drizzle/0003_catalog_validity_structured.sql
--
-- Idempotent: safe to re-run.
--
-- WHY. The fixed validity enum (single_visit | one_month | two_months | three_months)
-- is replaced by a STRUCTURED { amount, unit } pair (2026-07-23) so the owner can set
-- any positive whole number of days or months. This migration is ADDITIVE: it adds
-- the two structured columns and backfills them from the legacy text. The old
-- `validity` text column is KEPT (not dropped) — it is now DEAD (only the fallback for
-- rows the backfill can't reach), and new writes still stamp a best-effort token into
-- it to satisfy its NOT NULL constraint.

ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "validity_amount" integer;
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "validity_unit" text;

-- Backfill the structured pair from the legacy enum text. Guarded (only where NULL)
-- so re-running never clobbers a value the app has since written.
UPDATE "catalog_items"
SET "validity_amount" = CASE "validity"
      WHEN 'single_visit'  THEN 1
      WHEN 'one_month'     THEN 1
      WHEN 'two_months'    THEN 2
      WHEN 'three_months'  THEN 3
      ELSE 1
    END,
    "validity_unit" = 'month'
WHERE "validity_amount" IS NULL;

-- Constraints: when present, amount must be positive and unit must be day|month.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_item_validity_amount_positive') THEN
    ALTER TABLE "catalog_items"
      ADD CONSTRAINT "catalog_item_validity_amount_positive"
      CHECK ("validity_amount" IS NULL OR "validity_amount" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_item_validity_unit_valid') THEN
    ALTER TABLE "catalog_items"
      ADD CONSTRAINT "catalog_item_validity_unit_valid"
      CHECK ("validity_unit" IS NULL OR "validity_unit" IN ('day','month'));
  END IF;
END $$;
