-- LINE group chats that receive staff notifications (2026-10-12).
--
-- The owner invites the studio's LINE Official Account into a staff group; LINE then
-- sends a "join" webhook carrying the group id, which is recorded here. Every new
-- booking is pushed to each group still in it. A "leave" (bot removed from the
-- group) stamps left_at so pushes stop without losing the record.
create table if not exists line_notify_groups (
  group_id text primary key,
  -- The group's display name from LINE (best-effort; null if the lookup failed).
  name text,
  joined_at timestamptz not null default now(),
  left_at timestamptz
);
