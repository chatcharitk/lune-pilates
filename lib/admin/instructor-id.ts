// Pure instructor-id helpers, kept OUT of the "use server" action module so they can
// be exported and unit-tested directly. A Next.js "use server" file may only export
// async functions (every export becomes a callable server action), so this sync slug
// helper lives here and is imported by app/actions/instructors.ts.

/**
 * Slugify an EN name into an instructor id: lowercase, ASCII alphanumerics and
 * hyphens only, collapsed and trimmed. Returns "" when nothing usable remains (e.g.
 * a purely non-ASCII name) — the caller then falls back to a random id.
 */
export function slugifyInstructorId(name: string): string {
  // NFKD decomposes accented letters; the [^a-z0-9] pass then drops the combining
  // marks (and every other non-ASCII codepoint), so "José" → "jose", Thai → "".
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-") // non-alnum runs → single hyphen
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens
}
