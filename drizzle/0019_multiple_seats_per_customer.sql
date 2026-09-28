-- One customer may book several seats in the same class (owner, 2026-09-28).
--
-- A member books for the rest of the household from their own phone, so "one live
-- booking per (class, user)" was stopping a real, everyday use. Each seat stays its
-- own booking row — its own debit, its own reformer, cancelled and refunded on its
-- own — and remains bounded by capacity (checked under the class lock) and by
-- bookings_one_live_per_position, which is untouched: two seats can never share a
-- reformer.
drop index if exists bookings_one_live_per_user;
