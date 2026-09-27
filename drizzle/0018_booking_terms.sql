-- Booking terms (2026-09-27).
--
-- The studio's class rules — cancel at least 6 hours ahead, arrive 10 minutes
-- early, no entry more than 10 minutes late, grip socks throughout — shown and
-- accepted when a customer books, the same way the purchase terms are shown and
-- accepted at checkout.
--
-- They reuse terms_versions rather than a second table: the mechanics are identical
-- (append-only, the highest version is active, the owner publishes edits from
-- Settings) and duplicating them would give two versioning schemes to keep honest.
-- `kind` separates the two documents, and the version number becomes unique PER
-- KIND so the booking rules start at v1 alongside purchase terms already at v3.
alter table terms_versions add column if not exists kind text not null default 'purchase';

do $$ begin
  alter table terms_versions add constraint terms_versions_kind_valid
    check (kind in ('purchase', 'booking'));
exception when duplicate_object then null;
end $$;

alter table terms_versions drop constraint if exists terms_versions_version_key;
do $$ begin
  alter table terms_versions add constraint terms_versions_kind_version_key unique (kind, version);
exception when duplicate_object then null;
end $$;

-- Who has accepted which version. A purchase records its consent on the charge,
-- because every charge is a separate agreement. Booking is different: asking a
-- regular to re-tick the same four rules on every class would teach them to tick
-- without reading. So acceptance is recorded ONCE per user per version, and the
-- rules are asked for again only when the owner publishes a new version.
create table if not exists terms_acceptances (
  user_id uuid not null references users(id),
  terms_version_id uuid not null references terms_versions(id),
  accepted_at timestamptz not null default now(),
  primary key (user_id, terms_version_id)
);
