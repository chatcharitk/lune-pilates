// Studio photography used on class cards + the class-detail hero. The files live in
// public/studio/studio-1.jpg … studio-N.jpg. Each class TYPE has a fixed photo
// (decided 2026-07-20): group uses the group-reformer room, private/duo/trio use the
// private-studio shot. Rental is hidden from booking for now, but keeps a photo for
// any legacy data.
//
// Rendered as an <img> layered OVER the existing gradient, so if a file is missing
// the gradient shows through — the UI degrades to exactly its prior look.

import type { ClassType } from "@/lib/domain/types";

const BY_TYPE: Record<ClassType, string> = {
  group: "/studio/studio-2.jpg",
  private: "/studio/studio-1.jpg",
  duo: "/studio/studio-1.jpg",
  trio: "/studio/studio-1.jpg",
  rental: "/studio/studio-3.jpg",
};

/** The studio photo for a class type. */
export function studioImage(type: ClassType): string {
  return BY_TYPE[type] ?? "/studio/studio-1.jpg";
}
