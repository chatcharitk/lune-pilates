-- Packages whose credits are only good for certain days' classes (2026-09-12).
--
-- The owner wants special-priced classes on two specific dates. Price in this system
-- belongs to a PACKAGE, not to a class, and a package's credits were usable for any
-- class of the right format — so a special price could only ever be a special price
-- for everything, or a discount that depended on when someone happened to buy.
--
-- `class_days` pins a package's credits to the Bangkok days listed ("YYYY-MM-DD").
-- NULL means any day, which is every package that exists today, so this is purely
-- additive: nothing changes for an ordinary package. The check runs against the
-- CLASS's start day at booking time rather than the purchase date, which is what
-- lets an event class be sold in advance.
--
-- On catalog_items it is the owner's setting; on packages it is the snapshot taken at
-- purchase, so editing the item later cannot change what somebody already bought.
alter table catalog_items add column if not exists class_days text[];
alter table packages add column if not exists class_days text[];

-- The charge's own snapshot: what the customer bought, frozen at checkout, so an
-- edit to the item while the slip sits in review cannot change the days they paid
-- for (the same guarantee as the hours/validity snapshot beside it).
alter table charges add column if not exists class_days text[];
