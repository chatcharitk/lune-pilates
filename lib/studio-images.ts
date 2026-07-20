// Studio photography used on class cards + the class-detail hero. The files live in
// public/studio/studio-1.jpg … studio-N.jpg (drop the renders there). A class is
// assigned ONE photo deterministically from its id, so the same class always shows
// the same image (stable across renders) while the set varies across the schedule.
//
// Rendered as an <img> layered OVER the existing gradient, so if a file is missing
// the gradient shows through — the UI degrades to exactly its prior look.

export const STUDIO_IMAGE_COUNT = 4;

/** A stable `/studio/studio-N.jpg` path chosen from `seed` (e.g. a class id). */
export function studioImage(seed: string): string {
  // FNV-1a — a tiny, stable string hash (deterministic across server/client).
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const n = ((h >>> 0) % STUDIO_IMAGE_COUNT) + 1;
  return `/studio/studio-${n}.jpg`;
}
