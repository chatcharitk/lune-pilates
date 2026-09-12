-- Event discount codes (owner request, 2026-09-12): pre-opening, soft opening,
-- grand opening. lib/db/schema.ts → promoCodes, promoRedemptions, charges.promo*.
--
-- Apply by hand against Neon (db:push needs a TTY, unavailable in an agent session):
--   psql "$DATABASE_URL" -f drizzle/0010_promo_codes.sql
-- Idempotent: safe to re-run.
--
-- The code is the PRIMARY KEY and is stored UPPERCASE, so lookups are
-- case-insensitive without a functional index and the same code cannot exist twice
-- in different casing.
--
-- promo_redemptions.charge_id is the PRIMARY KEY: that is what makes redemption
-- counting idempotent, so a retried checkout cannot consume a second slot of a
-- capped code. Rows are never deleted (they are the audit trail); a cancelled or
-- rejected charge is excluded when counting instead, handing the slot back.
--
-- ADDITIVE: two new tables plus three nullable columns on `charges`. Existing
-- charges have no promo and read as full price, exactly as before.

CREATE TABLE IF NOT EXISTS "promo_codes" (
  "code" text PRIMARY KEY,
  "label_en" text NOT NULL,
  "label_th" text NOT NULL,
  "kind" text NOT NULL,
  "value" integer NOT NULL,
  "starts_at" timestamptz,
  "ends_at" timestamptz,
  "max_redemptions" integer,
  "max_per_customer" integer NOT NULL DEFAULT 1,
  "applies_to_category" "package_category",
  "applies_to_item_id" text REFERENCES "catalog_items"("id"),
  "first_purchase_only" boolean NOT NULL DEFAULT false,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promo_kind_valid') THEN
    ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_kind_valid"
      CHECK ("kind" IN ('percent','fixed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promo_value_positive') THEN
    ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_value_positive" CHECK ("value" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promo_percent_within_100') THEN
    ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_percent_within_100"
      CHECK ("kind" <> 'percent' OR "value" <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promo_max_redemptions_positive') THEN
    ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_max_redemptions_positive"
      CHECK ("max_redemptions" IS NULL OR "max_redemptions" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promo_max_per_customer_positive') THEN
    ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_max_per_customer_positive"
      CHECK ("max_per_customer" > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "promo_redemptions" (
  "charge_id" text PRIMARY KEY REFERENCES "charges"("charge_id"),
  "code" text NOT NULL REFERENCES "promo_codes"("code"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "discount_amount" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "promo_redemptions_code_idx" ON "promo_redemptions" ("code");

-- What the customer paid stays in `amount`; these say why it differs from the
-- catalog price, frozen at checkout so a later edit to the code cannot change it.
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "promo_code" text;
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "promo_discount" integer;
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "original_amount" integer;
