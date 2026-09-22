// The admin-side labels for class difficulty.
//
// Its own module so the class editor and the weekly template editor can share it
// without importing each other — schedule-view already renders TemplateEditor, and
// pointing the dependency back the other way would make a cycle out of a lookup
// table.

import type { ClassLevel } from "@/lib/domain/types";
import type { StrKey } from "@/lib/i18n";

export const LEVEL_KEY: Record<ClassLevel, StrKey> = {
  basic: "level_basic",
  intermediate: "level_intermediate",
  advance: "level_advance",
};
