import { sql } from "drizzle-orm";

// The OUTER class row's id, always written as "class_instances"."id", for
// correlated subqueries like "how many bookings does this class have".
//
// Interpolating `${classInstances.id}` is not safe there: Drizzle drops the table
// name from columns when the outer select has no joins, so it renders a bare "id"
// — which, inside `select count(*) from bookings where …`, binds to bookings.id.
// The count then never matches and is silently 0 (2026-10-10: the Instructors page
// showed 0/3 for full classes; the dashboard fill rate and alerts read 0 too).
export const OUTER_CLASS_ID = sql.raw(`"class_instances"."id"`);
