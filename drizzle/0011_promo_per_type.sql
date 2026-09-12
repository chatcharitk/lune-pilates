-- One code, a DIFFERENT discount per class format (owner request, 2026-09-12).
-- lib/db/schema.ts → promoCodeRules.
--
-- Apply by hand against Neon (db:push needs a TTY, unavailable in an agent session):
--   psql "$DATABASE_URL" -f drizzle/0011_promo_per_type.sql
-- Idempotent: safe to re-run.
--
-- WHY. A code used to carry ONE discount plus an optional "applies to this format"
-- restriction, so "฿200 off group, ฿500 off 1:1, ฿300 off duo" needed three separate
-- codes and three things to tell customers. The discount now lives per format: a
-- code has one rule per class type it covers, and covers only the types it has a
-- rule for — which also expresses the old restriction without a separate column.
--
-- SEQUENCING. This migration is ADDITIVE on purpose. The old kind/value/
-- applies_to_category columns are only made NULLABLE, not dropped, so the currently
-- deployed code keeps working in the window between this running and the new build
-- going live. Dropping them is drizzle/0012 — run it AFTER the deploy is confirmed.

CREATE TABLE IF NOT EXISTS "promo_code_rules" (
  "code" text NOT NULL REFERENCES "promo_codes"("code") ON DELETE CASCADE,
  "category" "package_category" NOT NULL,
  "kind" text NOT NULL,
  "value" integer NOT NULL,
  PRIMARY KEY ("code", "category")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promo_rule_kind_valid') THEN
    ALTER TABLE "promo_code_rules" ADD CONSTRAINT "promo_rule_kind_valid"
      CHECK ("kind" IN ('percent','fixed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promo_rule_value_positive') THEN
    ALTER TABLE "promo_code_rules" ADD CONSTRAINT "promo_rule_value_positive"
      CHECK ("value" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promo_rule_percent_within_100') THEN
    ALTER TABLE "promo_code_rules" ADD CONSTRAINT "promo_rule_percent_within_100"
      CHECK ("kind" <> 'percent' OR "value" <= 100);
  END IF;
END $$;

-- Backfill: every existing code keeps EXACTLY its current behaviour. A code with no
-- category restriction becomes a rule for all five formats at the same discount; a
-- restricted one becomes a single rule for the format it was limited to.
INSERT INTO "promo_code_rules" ("code", "category", "kind", "value")
SELECT c.code, cat.category, c.kind, c.value
FROM "promo_codes" c
CROSS JOIN (
  SELECT unnest(ARRAY['group','private','duo','trio','rental']::package_category[]) AS category
) cat
WHERE c.kind IS NOT NULL
  AND c.value IS NOT NULL
  AND (c.applies_to_category IS NULL OR c.applies_to_category = cat.category)
ON CONFLICT ("code", "category") DO NOTHING;

-- Legacy columns: kept for the deploy window, no longer written or read.
ALTER TABLE "promo_codes" ALTER COLUMN "kind" DROP NOT NULL;
ALTER TABLE "promo_codes" ALTER COLUMN "value" DROP NOT NULL;
