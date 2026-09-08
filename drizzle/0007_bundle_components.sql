-- Bundle packages: one catalog item granting several balances, each with its own
-- credit category and its own expiry clock.
-- lib/db/schema.ts → catalogItemComponents, packages.{component_key, activates_at,
-- activation_*}, packages.expires_at becoming NULLABLE.
--
-- Apply this by hand against the Neon database (db:push needs a TTY, unavailable in
-- an agent session):
--
--   psql "$DATABASE_URL" -f drizzle/0007_bundle_components.sql
--
-- Idempotent: safe to re-run.
--
-- WHY. The studio's ฿1,800 trial is one private (1:1) class usable within 14 days of
-- payment PLUS one free group class usable within 7 days OF THAT PRIVATE CLASS.
-- Two things the old model could not express:
--   1. One purchase → two balances in DIFFERENT credit categories. A purchase used
--      to create exactly one `packages` row.
--   2. An expiry anchored to an EVENT rather than the payment date. `expires_at` was
--      stamped once, at credit time.
--
-- expires_at BECOMING NULLABLE is the load-bearing part. NULL means "dormant — this
-- balance's clock has not started". Every bookable/balance query already filters
-- `expires_at > now()`, and no SQL comparison against NULL is ever true, so a dormant
-- package is automatically invisible to the booking engine, the balance and the pool
-- total. It fails CLOSED: a missed gate hides credit rather than granting it.
--
-- ADDITIVE: no existing row changes meaning. Existing packages keep a non-null
-- expiry and get component_key='main', which is exactly how they already behaved.

ALTER TABLE "packages" ALTER COLUMN "expires_at" DROP NOT NULL;

ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "activates_at" timestamptz;
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "component_key" text NOT NULL DEFAULT 'main';
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "activation_anchor_package_id" uuid;
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "activation_amount" integer;
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "activation_unit" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'packages_activation_anchor_fkey'
  ) THEN
    ALTER TABLE "packages"
      ADD CONSTRAINT "packages_activation_anchor_fkey"
      FOREIGN KEY ("activation_anchor_package_id") REFERENCES "packages"("id");
  END IF;
END $$;

-- Purchase idempotency moves from (charge) to (charge, component): a BUNDLE
-- legitimately creates one row per component for a single charge, while an ordinary
-- package — component_key 'main' — stays deduped exactly as before. component_key is
-- NOT NULL precisely so this works: Postgres treats NULLs as distinct, so a nullable
-- column here would have silently disabled the double-credit backstop.
ALTER TABLE "packages" DROP CONSTRAINT IF EXISTS "packages_purchase_charge_id_key";
ALTER TABLE "packages" DROP CONSTRAINT IF EXISTS "packages_purchase_charge_id_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "packages_charge_component_key"
  ON "packages" ("purchase_charge_id", "component_key");

CREATE TABLE IF NOT EXISTS "catalog_item_components" (
  "item_id" text NOT NULL REFERENCES "catalog_items"("id"),
  "component_key" text NOT NULL,
  "category" "package_category" NOT NULL,
  "hours" integer NOT NULL,
  "validity_amount" integer NOT NULL,
  "validity_unit" text NOT NULL,
  "anchor_component_key" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "label_en" text NOT NULL,
  "label_th" text NOT NULL,
  PRIMARY KEY ("item_id", "component_key")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_component_hours_positive') THEN
    ALTER TABLE "catalog_item_components"
      ADD CONSTRAINT "catalog_component_hours_positive" CHECK ("hours" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_component_validity_positive') THEN
    ALTER TABLE "catalog_item_components"
      ADD CONSTRAINT "catalog_component_validity_positive" CHECK ("validity_amount" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_component_validity_unit_valid') THEN
    ALTER TABLE "catalog_item_components"
      ADD CONSTRAINT "catalog_component_validity_unit_valid"
      CHECK ("validity_unit" IN ('day','month'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_component_anchor_not_self') THEN
    ALTER TABLE "catalog_item_components"
      ADD CONSTRAINT "catalog_component_anchor_not_self"
      CHECK ("anchor_component_key" IS NULL OR "anchor_component_key" <> "component_key");
  END IF;
END $$;

-- The components a bundle charge was opened against, frozen at checkout. Same
-- rationale as the hours/validity snapshot columns (migration 0002/0004): the
-- catalog is owner-editable and a charge may sit in `awaiting_review` for days, so
-- crediting must read what the customer actually bought, not what the item says now.
-- NULL for plain items and for pre-bundle charges; both fall back to live resolution.
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "components_json" text;

-- Which booking started an anchored package's clock. Needed so CANCELLING that
-- booking returns the package to dormant: without it a customer could book the
-- anchor class purely to unlock the free one, cancel the anchor, and keep the
-- unlocked credit.
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "activation_booking_id" uuid;

-- Trial offers: purchasable only by a customer with no prior paid purchase.
-- Enforced in createCheckout and used to hide the item from everyone else's buy screen.
ALTER TABLE "catalog_items" ADD COLUMN IF NOT EXISTS "first_purchase_only" boolean NOT NULL DEFAULT false;
