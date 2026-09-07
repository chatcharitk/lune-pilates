// Owner-editable studio identity — name, address, phone, opening hours, and an
// optional maps link. Backed by the single-row `studio_settings` table (see its
// doc in lib/db/schema.ts); SEED_STUDIO_INFO below is the seed + the
// empty-table/no-DB fallback, mirroring loadCatalogMap / loadVisibilityWindows.
//
// This is presentational studio info, not policy or money — nothing here gates a
// booking or a charge.

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { studioSettings } from "@/lib/db/schema";
import type { Bilingual } from "@/lib/i18n";
import { mockDataMode } from "@/lib/mock-mode";

/** The pinned primary key — the table holds exactly one row (CHECK-enforced). */
export const STUDIO_SETTINGS_ID = "default";

export interface StudioInfo {
  name: Bilingual;
  address: Bilingual;
  phone: string;
  /** An http(s) maps deep-link, or null. Validated before it is ever stored. */
  mapUrl: string | null;
  hours: Bilingual;
}

/**
 * Placeholder studio details. Intentionally generic: the owner replaces these in
 * Settings → Studio info, and nothing in the app depends on the values.
 */
export const SEED_STUDIO_INFO: StudioInfo = {
  name: { en: "LUNE Pilates", th: "LUNE Pilates" },
  address: { en: "Bangkok, Thailand", th: "กรุงเทพมหานคร ประเทศไทย" },
  phone: "",
  mapUrl: null,
  hours: {
    en: "Mon–Fri 07:00–20:00 · Sat–Sun 08:00–17:00",
    th: "จันทร์–ศุกร์ 07:00–20:00 · เสาร์–อาทิตย์ 08:00–17:00",
  },
};

/** The studio's info, falling back to the seed when unset / no database. */
export async function loadStudioInfo(): Promise<StudioInfo> {
  if (mockDataMode()) return SEED_STUDIO_INFO;

  const db = getDb();
  const [row] = await db
    .select()
    .from(studioSettings)
    .where(eq(studioSettings.id, STUDIO_SETTINGS_ID))
    .limit(1);

  if (!row) return SEED_STUDIO_INFO;
  return {
    name: { en: row.nameEn, th: row.nameTh },
    address: { en: row.addressEn, th: row.addressTh },
    phone: row.phone,
    mapUrl: row.mapUrl,
    hours: { en: row.hoursEn, th: row.hoursTh },
  };
}
