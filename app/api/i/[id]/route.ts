// Serve an uploaded image by link.
//
// PUBLIC BY DESIGN — this route is the whole point of the uploads table: a LINE rich
// menu, a poster, a QR page all need a plain URL that anyone can fetch, with no
// session. The id is a random UUID, so a link is unguessable, but it is a link:
// whatever is uploaded here is readable by anyone who has it, which is why nothing
// private is ever put in this table.
//
// Cached immutably because the row never changes: an edit uploads a NEW image with a
// new id, so a URL always means the same bytes.

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { uploads } from "@/lib/db/schema";
import { mockDataMode } from "@/lib/mock-mode";

/** Decode `data:<mime>;base64,…` into bytes, or null when the row is malformed. */
function decode(dataUrl: string): { bytes: Buffer; mime: string } | null {
  const match = /^data:([\w.+/-]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  try {
    return { bytes: Buffer.from(match[2] ?? "", "base64"), mime: match[1] ?? "image/png" };
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Short-circuit BEFORE the query: the column is uuid, so a non-uuid id would make
  // Postgres raise rather than simply miss.
  if (!UUID.test(id) || mockDataMode()) {
    return new Response("Not found", { status: 404 });
  }

  const [row] = await getDb()
    .select({ dataUrl: uploads.dataUrl, mimeType: uploads.mimeType })
    .from(uploads)
    .where(eq(uploads.id, id))
    .limit(1);
  if (!row) return new Response("Not found", { status: 404 });

  const decoded = decode(row.dataUrl);
  if (!decoded) return new Response("Not found", { status: 404 });

  return new Response(decoded.bytes as unknown as BodyInit, {
    headers: {
      // The stored mime is the SNIFFED one (lib/images/sniff.ts), never the
      // uploader's claim, so serving it back cannot turn a file into something else.
      "content-type": row.mimeType,
      "content-length": String(decoded.bytes.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
      // Belt and braces for a route that serves user-supplied bytes.
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
