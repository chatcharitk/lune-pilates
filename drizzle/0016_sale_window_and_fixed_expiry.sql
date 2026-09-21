-- A sale window, and a fixed expiry date (2026-09-17).
--
-- The owner's trial offer runs 30 Sep – 30 Oct and everything bought in it expires
-- on 30 Nov, however late it was bought. Neither of those could be expressed:
-- packages were purchasable until archived by hand, and their lifetime was always
-- relative ("30 days from purchase"), which would have let a 30 Oct buyer use
-- classes into December.
--
-- `sale_starts_on` / `sale_ends_on` bound when an item may be bought. `expires_on`
-- fixes the day its credits die, overriding validity_amount/unit at purchase. All
-- three are Bangkok days ("YYYY-MM-DD"), inclusive, matching how every other date
-- in the system is read. Null on all three — every package that exists today — keeps
-- the current behaviour exactly.
alter table catalog_items add column if not exists sale_starts_on text;
alter table catalog_items add column if not exists sale_ends_on text;
alter table catalog_items add column if not exists expires_on text;

-- The charge's own snapshot, frozen at checkout like the hours/validity beside it,
-- so editing the item while a slip sits in review cannot change what was bought.
alter table charges add column if not exists expires_on text;
