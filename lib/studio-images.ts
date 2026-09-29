// Studio photography used on class cards + the class-detail hero. The files live in
// public/studio/studio-1.jpg … studio-N.jpg. Each class TYPE has a fixed photo
// (decided 2026-07-20): group uses the group-reformer room, private/duo/trio use the
// private-studio shot. Rental is hidden from booking for now, but keeps a photo for
// any legacy data.
//
// Rendered as an <img> layered OVER the existing gradient, so if a file is missing
// the gradient shows through — the UI degrades to exactly its prior look.

import type { ClassType } from "@/lib/domain/types";

// Replaced 2026-09-27 with the owner's own photos of the finished studio: the reformer
// row for group classes, the full room for every private format. New file names
// rather than overwriting studio-1/2, so a browser holding the old image cached is
// not left showing it under the old URL.
const BY_TYPE: Record<ClassType, string> = {
  group: "/studio/studio-group.jpg",
  private: "/studio/studio-private.jpg",
  duo: "/studio/studio-private.jpg",
  trio: "/studio/studio-private.jpg",
  // The owner's own rental photo (2026-09-29): the studio with its reformers, props
  // shelf and lounge — what a customer is actually hiring.
  rental: "/studio/studio-rental.jpg",
};

/** The studio photo for a class type. */
export function studioImage(type: ClassType): string {
  return BY_TYPE[type] ?? "/studio/studio-private.jpg";
}
