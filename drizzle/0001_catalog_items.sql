-- Editable purchasable package catalog (lib/db/schema.ts → catalogItems).
--
-- Apply this by hand against the Neon database: `npm run db:push` requires a TTY
-- and cannot be run from an agent session.
--
--   psql "$DATABASE_URL" -f drizzle/0001_catalog_items.sql
--
-- Idempotent: safe to re-run. After applying, populate the table with
--   npx tsx scripts/seed-catalog.ts
--
-- NOTE on `id`: it is a stable slug ("p10", "pv8", …), NOT a uuid — it is already
-- the value stored in packages.type and charges.package_id. Items are never
-- hard-deleted, only archived (active = false), so historical charges and unspent
-- credits always resolve.

CREATE TABLE IF NOT EXISTS "catalog_items" (
  "id"         text PRIMARY KEY NOT NULL,
  "category"   "package_category" NOT NULL,
  "hours"      integer NOT NULL,
  "price"      integer NOT NULL,
  "validity"   text NOT NULL,
  "tag"        text,
  "label_en"   text NOT NULL,
  "label_th"   text NOT NULL,
  "active"     boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "catalog_items"
    ADD CONSTRAINT "catalog_item_hours_positive" CHECK ("hours" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "catalog_items"
    ADD CONSTRAINT "catalog_item_price_nonneg" CHECK ("price" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- The buy/POS listing reads active items ordered by category then sort_order.
CREATE INDEX IF NOT EXISTS "catalog_items_active_sort_idx"
  ON "catalog_items" ("active", "category", "sort_order");
