"use server";

// Thin server-action wrapper so the client roster drawer can fetch a single
// class's roster on demand (open + after each check-in/position/cancel). The
// read model itself is admin-gated (returns null for non-admins).

import { getClassRoster, type AdminClassRoster } from "@/lib/admin/class-roster";

export async function loadClassRoster(classInstanceId: string): Promise<AdminClassRoster | null> {
  return getClassRoster(classInstanceId);
}
