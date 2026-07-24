-- Owner-configurable tiered-visibility lead time (CLAUDE.md §5 invariant 4),
-- lib/db/schema.ts → visibilityWindows.
--
-- Apply this by hand against the Neon database (db:push needs a TTY, unavailable in
-- an agent session):
--
--   psql "$DATABASE_URL" -f drizzle/0005_visibility_windows.sql
--
-- Idempotent: safe to re-run.
--
-- WHY. The lead time before a class becomes visible/bookable (`public_visible_at =
-- starts_at - N hours`) was a hardcoded constant (DEFAULT_PUBLIC_LEAD_HOURS,
-- lib/domain/types.ts), GUEST-only — members had no gate at all. This migration adds
-- a new table so the studio owner can set the lead time per class type AND per
-- customer tier (member vs guest), each as a structured amount+unit (day/week/month).
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE IF NOT EXISTS, no existing table touched.
-- No backfill/seed rows are inserted here — the app falls back to
-- SEED_VISIBILITY_WINDOWS (lib/schedule/visibilityWindows.ts) whenever this table is
-- empty, exactly like BASELINE_SLOTS / SEED_CATALOG do for their tables. Seeding real
-- rows (if ever desired) is a separate, explicit owner action via the admin screen.

CREATE TABLE IF NOT EXISTS "visibility_windows" (
  "type" "class_type" PRIMARY KEY,
  "member_amount" integer NOT NULL,
  "member_unit" text NOT NULL,
  "guest_amount" integer NOT NULL,
  "guest_unit" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visibility_window_member_amount_positive') THEN
    ALTER TABLE "visibility_windows"
      ADD CONSTRAINT "visibility_window_member_amount_positive"
      CHECK ("member_amount" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visibility_window_guest_amount_positive') THEN
    ALTER TABLE "visibility_windows"
      ADD CONSTRAINT "visibility_window_guest_amount_positive"
      CHECK ("guest_amount" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visibility_window_member_unit_valid') THEN
    ALTER TABLE "visibility_windows"
      ADD CONSTRAINT "visibility_window_member_unit_valid"
      CHECK ("member_unit" IN ('day','week','month'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visibility_window_guest_unit_valid') THEN
    ALTER TABLE "visibility_windows"
      ADD CONSTRAINT "visibility_window_guest_unit_valid"
      CHECK ("guest_unit" IN ('day','week','month'));
  END IF;
END $$;
