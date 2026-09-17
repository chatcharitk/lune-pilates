-- Images the owner uploads to get a link for (2026-09-17).
--
-- The LINE rich menu is the reason this exists: its buttons point at URLs, so the
-- studio needs somewhere of its own to put artwork and get a stable address back.
--
-- Bytes live in the row as a data URL, the same choice instructor photos make. A few
-- images of a few hundred KB do not justify a second storage path with its own
-- credentials and failure modes; R2 keeps doing what it was chosen for, which is
-- holding the PII in payment slips.
create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  data_url text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now()
);
