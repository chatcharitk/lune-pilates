"use server";

// Owner-only image uploads (Settings → Links & images).
//
// The studio's LINE rich menu points its buttons at URLs, so the owner needs a place
// to put an image and get a link back. Each upload becomes /api/i/<id>, which is
// PUBLIC — that is the requirement, not an oversight — so the copy beside the
// uploader says so, and nothing private is meant to go here.
//
// Conventions mirror the other owner-only actions: `requireOwner()` first, before
// input parsing and before the no-DB branch, so an unauthorised caller reads
// UNAUTHORIZED rather than a code that would leak schema validity or deploy mode.

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { uploads } from "@/lib/db/schema";
import { requireOwner } from "@/lib/auth/admin";
import { mockDataMode } from "@/lib/mock-mode";
import { canonicalUploadDataUrl, validateUploadDataUrl } from "@/lib/images/upload";

export type UploadFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  /** Not an image we accept (or a mime that lied about its bytes). */
  | "INVALID_FILE"
  | "TOO_LARGE"
  | "MOCK_NO_DB";

/** One uploaded image as the admin list shows it. `path` is site-relative. */
export interface AdminUpload {
  id: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /** Where the bytes are served from; the page prefixes the site origin. */
  path: string;
}

export type ListUploadsResult =
  | { ok: true; items: AdminUpload[] }
  | { ok: false; code: "UNAUTHORIZED" };

export async function listUploads(): Promise<ListUploadsResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };
  if (mockDataMode()) return { ok: true, items: [] };

  const rows = await getDb()
    .select({
      id: uploads.id,
      title: uploads.title,
      mimeType: uploads.mimeType,
      sizeBytes: uploads.sizeBytes,
      createdAt: uploads.createdAt,
    })
    .from(uploads)
    .orderBy(desc(uploads.createdAt));

  return {
    ok: true,
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt.toISOString(),
      path: `/api/i/${r.id}`,
    })),
  };
}

const saveInput = z.object({
  title: z.string().trim().min(1).max(80),
  /** A `data:image/...;base64,…` URL from the browser's file reader. */
  dataUrl: z.string().min(1).max(4_000_000),
});
export type SaveUploadInput = z.infer<typeof saveInput>;

export type SaveUploadResult =
  | { ok: true; id: string; path: string }
  | { ok: false; code: UploadFailureCode };

/** Store an image and hand back the link that serves it. */
export async function saveUpload(raw: SaveUploadInput): Promise<SaveUploadResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = saveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };

  // Magic bytes, not the declared mime: the stored type is what the file ACTUALLY
  // is, so the public route can never be talked into serving something else.
  const image = validateUploadDataUrl(parsed.data.dataUrl);
  if (!image.ok) return { ok: false, code: image.code };

  if (mockDataMode()) return { ok: false, code: "MOCK_NO_DB" };

  const [row] = await getDb()
    .insert(uploads)
    .values({
      title: parsed.data.title,
      dataUrl: canonicalUploadDataUrl(image),
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
    })
    .returning({ id: uploads.id });
  if (!row) return { ok: false, code: "INVALID_INPUT" };

  revalidatePath("/admin/settings/links");
  return { ok: true, id: row.id, path: `/api/i/${row.id}` };
}

export type DeleteUploadResult = { ok: true } | { ok: false; code: UploadFailureCode };

/**
 * Delete an image for good.
 *
 * There is no archive state here, deliberately: an image's only purpose is to be
 * linked, and a link that must stop working has to actually stop working. Anything
 * still pointing at it — a rich menu button, a printed QR — will break, which is the
 * honest outcome and the reason the button asks first.
 */
export async function deleteUpload(id: string): Promise<DeleteUploadResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  if (mockDataMode()) return { ok: false, code: "MOCK_NO_DB" };

  await getDb().delete(uploads).where(eq(uploads.id, parsed.data));
  revalidatePath("/admin/settings/links");
  return { ok: true };
}
