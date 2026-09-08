-- Separate credit pools for 1:1, Duo and Trio (owner, 2026-09-08).
--
-- Apply by hand against Neon (db:push needs a TTY, unavailable in an agent session):
--   psql "$DATABASE_URL" -f drizzle/0008_split_private_pools.sql
-- Idempotent: safe to re-run.
--
-- WHY. `package_category` decides which balance a booking debits
-- (lib/credits/selectPackage.ts). 1:1, Duo and Trio all mapped to ONE "private"
-- category, so a single balance covered all three — while the items feeding it are
-- priced ฿1,500–฿2,300 per class. A customer could buy the 1:1 10-pack at
-- ฿1,500/class and spend it on Trio classes worth ฿2,000/class. Giving each its own
-- category makes a balance usable only for the class type it was sold for.
--
-- SAFE TO DO NOW, and only now: every existing package is `group`, so no live
-- customer balance changes category. Once customers hold real 1:1/Duo/Trio
-- balances this migration would have to move them, and any mis-assignment would be
-- money in the wrong pocket.

ALTER TYPE "package_category" ADD VALUE IF NOT EXISTS 'duo';
ALTER TYPE "package_category" ADD VALUE IF NOT EXISTS 'trio';

-- Move the Duo and Trio items into their own pools. Safe because no package row
-- references them yet (every existing package is `group`); once real balances exist
-- this would have to migrate those rows too.
UPDATE "catalog_items" SET "category" = 'duo'  WHERE "id" IN ('duo-drop', 'duo8');
UPDATE "catalog_items" SET "category" = 'trio' WHERE "id" IN ('trio-drop', 'trio8');
