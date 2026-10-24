import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { bookings } from "@/lib/db/schema";
import { mockDataMode } from "@/lib/mock-mode";

/**
 * Live (not cancelled) bookings on a class — what the last-minute booking rule
 * (isTooLateToSelfBook, lib/domain/types.ts) needs to know: is anyone already in?
 * No-DB dev mode reports 0.
 */
export async function liveBookingCount(classInstanceId: string): Promise<number> {
  if (mockDataMode()) return 0;
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(eq(bookings.classInstanceId, classInstanceId), eq(bookings.status, "booked")));
  return row?.n ?? 0;
}
