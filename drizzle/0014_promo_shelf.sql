-- "Buy one, get one" packages on their own shelf (2026-09-13).
--
-- Two additions, both to catalog_items:
--
-- `promo_shelf` — display only. A promotional package gets its own tab in the buy
-- screen instead of sitting among the ordinary packs of its format. It deliberately
-- does NOT become a new package category: credits are matched to classes BY
-- category, so a "promo" category would be credits that can book nothing. A 1+1
-- group package still grants group credits.
--
-- `max_per_customer` — how many times one customer may buy the item, ever. Null is
-- unlimited (every package that exists today). 1 keeps an introductory offer
-- introductory: without it, "buy one get one" is simply half price forever.
alter table catalog_items add column if not exists promo_shelf boolean not null default false;
alter table catalog_items add column if not exists max_per_customer integer;
