-- Studio rental becomes an exclusive booking priced by head-count (2026-09-29).
--
-- A rental was modelled as a 3-seat class and all three rental packages granted the
-- SAME credit, so a "3 people · ฿1,000" pack booked one seat and left the other two
-- open to strangers. The owner's model: the customer hires the whole studio for the
-- slot, and the price follows how many people come — 1, 2 or 3 — with each size's
-- credit usable only for a rental of exactly that size.
--
-- party_size records that size on the item (the owner's setting), the charge (the
-- snapshot sold), the package (what the credit is good for) and the booking (what
-- was hired). Null everywhere outside rental.
alter table catalog_items add column if not exists party_size integer;
alter table charges add column if not exists party_size integer;
alter table packages add column if not exists party_size integer;
alter table bookings add column if not exists party_size integer;

update catalog_items set party_size = 1 where id = 'r-solo';
update catalog_items set party_size = 2 where id = 'r-duo';
update catalog_items set party_size = 3 where id = 'r-trio';

-- Existing rental credits and bookings take their size from the package they came from.
update packages set party_size = case type when 'r-solo' then 1 when 'r-duo' then 2 when 'r-trio' then 3 end
  where category = 'rental' and party_size is null and type in ('r-solo','r-duo','r-trio');
update charges set party_size = case package_id when 'r-solo' then 1 when 'r-duo' then 2 when 'r-trio' then 3 end
  where party_size is null and package_id in ('r-solo','r-duo','r-trio');
update bookings b set party_size = p.party_size
  from packages p
  where b.package_id = p.id and p.category = 'rental' and b.party_size is null;

-- A rental slot is the whole studio: one booking fills it.
update class_instances set capacity = 1 where type = 'rental' and capacity <> 1;
update class_templates set capacity = 1 where type = 'rental' and capacity <> 1;
