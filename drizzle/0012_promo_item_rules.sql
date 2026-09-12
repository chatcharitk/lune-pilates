-- Per-PACKAGE promo amounts (2026-09-12).
--
-- promo_code_rules says what a code is worth for a class FORMAT. That is the right
-- default, but it cannot say "฿200 off a single group class and ฿800 off the group
-- 10-class pack" — one flat amount is a quarter off a drop-in and a rounding error
-- on a pack. This table overrides the format amount for one package.
--
-- A package listed here is covered even if its format is not, so a code can discount
-- nothing but the 10-class pack. Resolution at charge time: item rule, else format
-- rule, else the code does not apply.
--
-- Purely additive: no existing code has item rules, so every code keeps behaving
-- exactly as it does today.
create table if not exists promo_item_rules (
  code text not null references promo_codes(code) on delete cascade,
  item_id text not null references catalog_items(id),
  kind text not null,
  value integer not null,
  primary key (code, item_id),
  constraint promo_item_rule_kind_valid check (kind in ('percent','fixed')),
  constraint promo_item_rule_value_positive check (value > 0),
  constraint promo_item_rule_percent_within_100 check (kind <> 'percent' or value <= 100)
);
