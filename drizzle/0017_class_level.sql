-- Class difficulty (2026-09-21).
--
-- The studio teaches the same format at different levels, and a customer choosing a
-- class needs to know which one they are walking into. Set when the class is created
-- (or on the weekly template, from which generated classes inherit it).
--
-- NULLABLE on purpose: every class that exists today has no level, and an absent
-- level renders as NOTHING rather than defaulting to "basic" — telling a beginner a
-- class is basic when nobody said so is the one failure mode worth designing out.
do $$ begin
  create type class_level as enum ('basic', 'intermediate', 'advance');
exception
  when duplicate_object then null;
end $$;

alter table class_templates add column if not exists level class_level;
alter table class_instances add column if not exists level class_level;
