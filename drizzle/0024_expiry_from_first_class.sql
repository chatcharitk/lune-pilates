-- A package's validity counts from its FIRST CLASS, not the purchase (2026-10-14).
--
-- first_class_deadline: the latest moment the clock can start — purchase + 30 days.
--   If the first class is later (or never booked), the clock starts here anyway.
--   NULL = an ordinary package whose expiry was fixed at purchase (fixed-date
--   campaigns, event-day packs, promo-shelf packs, and everything sold before this).
-- first_class_window_amount/_unit: the validity to count once the clock starts.
--
-- expires_at is always kept set (so every bookable/balance query keeps working):
--   not started → deadline + window (the latest it could ever end);
--   started     → (earliest live booked class on it, capped at the deadline) + window.
-- It is recomputed inside the booking / cancel / reschedule transactions.
alter table packages add column if not exists first_class_deadline timestamptz;
alter table packages add column if not exists first_class_window_amount integer;
alter table packages add column if not exists first_class_window_unit text;
-- first_class_started_at: when the clock started (the first class, or the deadline);
-- NULL while it hasn't. Kept by recomputeFirstClassClock alongside expires_at.
alter table packages add column if not exists first_class_started_at timestamptz;
