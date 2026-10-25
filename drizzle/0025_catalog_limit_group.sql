-- One purchase allowance shared by several packages (2026-10-25).
--
-- max_per_customer counted each item on its own, so "one trial per customer" was
-- really one trial PER TYPE: a customer could take the group trial and then the 1:1
-- trial. Items sharing a limit_group share ONE allowance — the group's purchases are
-- counted together against each item's max_per_customer. Null = the item counts
-- only itself, as before.
alter table catalog_items add column if not exists limit_group text;
update catalog_items set limit_group = 'trial'
 where id in ('trial-group', 'trial-priv', 'trial-duo', 'trial-trio');
