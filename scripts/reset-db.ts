// DEV ONLY — truncate all tables so the seed can rebuild a pristine demo state.
// Destructive. Requires DATABASE_URL. Never run against a real/production DB.
//
//   npm run db:reset && npm run db:seed

import "./_load-env";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

async function main() {
  const db = getDb();
  await db.execute(
    sql`TRUNCATE waitlist, credit_ledger, bookings, class_instances, class_templates, packages, instructor_availability, users, households, instructors RESTART IDENTITY CASCADE`,
  );
  console.info("DB reset: all tables truncated.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
