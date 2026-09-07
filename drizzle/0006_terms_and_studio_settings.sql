-- Purchase Terms & Conditions + studio info, and the per-charge consent record.
-- lib/db/schema.ts → termsVersions, studioSettings, charges.termsVersionId.
--
-- Apply this by hand against the Neon database (db:push needs a TTY, unavailable in
-- an agent session):
--
--   psql "$DATABASE_URL" -f drizzle/0006_terms_and_studio_settings.sql
--
-- Idempotent: safe to re-run.
--
-- WHY. The studio owner requires every customer to read and tick the studio's Terms
-- & Conditions before paying, and to be able to edit those terms herself. Two
-- properties drive this shape:
--
--   1. terms_versions is APPEND-ONLY. "Editing" the T&C inserts a new row; rows are
--      never updated or deleted. charges.terms_version_id points at the exact
--      version its customer accepted, so a later rewrite can never retroactively
--      change the terms of a past purchase. This mirrors the charge terms-snapshot
--      columns (0002/0004), which freeze hours/price for the same reason.
--   2. studio_settings holds exactly ONE row, pinned to id='default' by a CHECK, so
--      reads never have to choose between rows.
--
-- ADDITIVE + IDEMPOTENT: two new tables, two new NULLABLE columns on `charges`. No
-- existing row is read or rewritten, and no backfill is performed — charges opened
-- before this migration simply have no consent record (they predate the requirement).
-- No seed rows are inserted: the app falls back to SEED_TERMS / SEED_STUDIO_INFO
-- (lib/settings/*.ts) whenever these tables are empty, exactly as BASELINE_SLOTS,
-- SEED_CATALOG and SEED_VISIBILITY_WINDOWS do for theirs.

CREATE TABLE IF NOT EXISTS "terms_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer NOT NULL UNIQUE,
  "body_en" text NOT NULL,
  "body_th" text NOT NULL,
  "published_by_admin_id" text,
  "published_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "studio_settings" (
  "id" text PRIMARY KEY DEFAULT 'default',
  "name_en" text NOT NULL,
  "name_th" text NOT NULL,
  "address_en" text NOT NULL,
  "address_th" text NOT NULL,
  "phone" text NOT NULL,
  "map_url" text,
  "hours_en" text NOT NULL,
  "hours_th" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'studio_settings_single_row') THEN
    ALTER TABLE "studio_settings"
      ADD CONSTRAINT "studio_settings_single_row"
      CHECK ("id" = 'default');
  END IF;
END $$;

-- The consent record on each charge. NULLABLE: pre-migration charges have none, and
-- admin POS (in-person) sales do not collect one.
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "terms_version_id" uuid;
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'charges_terms_version_id_fkey') THEN
    ALTER TABLE "charges"
      ADD CONSTRAINT "charges_terms_version_id_fkey"
      FOREIGN KEY ("terms_version_id") REFERENCES "terms_versions"("id");
  END IF;
END $$;
