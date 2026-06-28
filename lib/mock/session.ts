// TEMPORARY mock data source for v1 UI development. Mirrors the prototype's USER
// and a slice of the week (lune-pilates/project/lune-data.jsx). Replace each
// reader with a real Drizzle query against the schema as endpoints come online.

import type { Bilingual } from "@/lib/i18n";

export interface MockNextClass {
  type: string;
  label: Bilingual;
  date: Bilingual;
  time: string;
  durationMin: number;
  instructor?: Bilingual;
}

export interface MockSession {
  name: Bilingual;
  isMember: boolean;
  house: string;
  /** shared household pool balance, in hours */
  credits: number;
  isHouseholdPool: boolean;
  validUntil: Bilingual;
  next: MockNextClass | null;
}

export function getMockSession(): MockSession {
  return {
    name: { en: "Pim", th: "พิม" },
    isMember: true,
    house: "A-114",
    credits: 8,
    isHouseholdPool: true,
    validUntil: { en: "24 Jun 2026", th: "24 มิ.ย. 2569" },
    next: {
      type: "group",
      label: { en: "Reformer Group", th: "รีฟอร์มเมอร์กลุ่ม" },
      date: { en: "Today", th: "วันนี้" },
      time: "17:00",
      durationMin: 60,
    },
  };
}
