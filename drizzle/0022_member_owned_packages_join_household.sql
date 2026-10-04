-- 2026-10-04: a guest promoted to member now brings their own packages into the
-- household (app/actions/admin-members.ts updateCustomer). One-time backfill for
-- members promoted before that change, whose guest-bought classes were stranded:
-- a member's balance reads only the household pool, so these were invisible.
-- No ledger rows change; only the owner of each package moves.
UPDATE packages p
   SET owner_household_id = u.household_id,
       owner_user_id = NULL
  FROM users u
 WHERE p.owner_user_id = u.id
   AND u.tier = 'member'
   AND u.household_id IS NOT NULL;
