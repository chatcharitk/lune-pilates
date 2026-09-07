"use server";

// Owner-only admin actions for the Settings section: the purchase Terms &
// Conditions (Settings → Terms & Conditions) and the studio's own details
// (Settings → Studio info).
//
// Follows the conventions of app/actions/admin-visibility.ts and
// admin-catalog.ts (read either for the house style this mirrors):
//   - every action's line 1 is `requireOwner()`, BEFORE input parsing and before
//     the no-DB branch, so an unauthorised caller always reads UNAUTHORIZED —
//     never INVALID_INPUT (which would leak schema validity) or MOCK_NO_DB (which
//     would leak deploy-mode information).
//   - MOCK_NO_DB: in `mockDataMode()` a validated write has nowhere to persist, so
//     it is reported as a FAILURE (never a fake ok:true).
//
// TERMS ARE APPEND-ONLY. `publishTerms` INSERTS a new version; there is
// deliberately no update and no delete action, because charges reference the exact
// version their customer ticked (charges.terms_version_id) and editing a row in
// place would retroactively rewrite the terms of every past purchase. See the
// `terms_versions` doc in lib/db/schema.ts.

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { studioSettings, termsVersions } from "@/lib/db/schema";
import { loadActiveTerms, loadTermsHistory, type TermsVersion } from "@/lib/settings/terms";
import {
  loadStudioInfo,
  STUDIO_SETTINGS_ID,
  type StudioInfo,
} from "@/lib/settings/studio";
import { requireOwner } from "@/lib/auth/admin";
import { mockDataMode } from "@/lib/mock-mode";

/**
 * MOCK_NO_DB — mirrors admin-visibility.ts: the action ran in `mockDataMode()`, so
 * the input VALIDATED but NOTHING was persisted. Reported as a FAILURE deliberately.
 */
export type MockNoDbCode = "MOCK_NO_DB";

// ───────────────────────── terms: read ─────────────────────────

export type ListTermsFailureCode = "UNAUTHORIZED";
export type ListTermsResult =
  | { ok: true; active: TermsVersion; history: TermsVersion[] }
  | { ok: false; code: ListTermsFailureCode };

/**
 * The active terms plus the full published history (newest first) for the editor.
 * Owner-only: the history is an audit trail of what customers were bound to.
 */
export async function listTerms(): Promise<ListTermsResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const [active, history] = await Promise.all([loadActiveTerms(), loadTermsHistory()]);
  return { ok: true, active, history };
}

// ───────────────────────── terms: publish ─────────────────────────

// A generous ceiling that still rejects a runaway paste. Real studio T&C run to a
// few thousand characters; 40k is far beyond any plausible document.
const TERMS_MAX_CHARS = 40_000;

const publishTermsInput = z.object({
  bodyEn: z.string().trim().min(1).max(TERMS_MAX_CHARS),
  bodyTh: z.string().trim().min(1).max(TERMS_MAX_CHARS),
});
export type PublishTermsInput = z.infer<typeof publishTermsInput>;

export type PublishTermsFailureCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "UNCHANGED"
  | MockNoDbCode;
export type PublishTermsResult =
  | { ok: true; version: TermsVersion }
  | { ok: false; code: PublishTermsFailureCode };

/**
 * Publish a NEW terms version. The next `version` is computed inside the statement
 * from the table's current max, and `version` is UNIQUE — so two owners publishing
 * at the same instant cannot mint the same number; the loser's insert fails and is
 * reported as a normal error rather than silently overwriting.
 *
 * Refuses an UNCHANGED publish (both bodies identical to the active version) so the
 * history stays a meaningful record of actual policy changes rather than filling up
 * with no-op saves.
 *
 * Existing charges are untouched: each keeps pointing at the version its customer
 * ticked, so this never alters the terms of a past purchase — only future checkouts
 * see the new text.
 */
export async function publishTerms(raw: PublishTermsInput): Promise<PublishTermsResult> {
  const session = await requireOwner();
  if (!session) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = publishTermsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  if (mockDataMode()) return { ok: false, code: "MOCK_NO_DB" };

  const active = await loadActiveTerms();
  if (active.bodyEn === input.bodyEn && active.bodyTh === input.bodyTh) {
    return { ok: false, code: "UNCHANGED" };
  }

  const db = getDb();
  const [row] = await db
    .insert(termsVersions)
    .values({
      // max(version) + 1, computed in the database so concurrent publishes race on
      // the UNIQUE constraint rather than on a value read into application memory.
      //
      // The empty-table case starts at 2, NOT 1: SEED_TERMS permanently occupies v1
      // (lib/settings/terms.ts), and a customer may have accepted it while the table
      // was still empty. Minting a second, different "v1" would make the version
      // number the studio shows and records ambiguous — two customers told they
      // accepted "v1" having read different text. Every number stays unique to one
      // body this way.
      version: sql`(select coalesce(max(${termsVersions.version}), 1) + 1 from ${termsVersions})`,
      bodyEn: input.bodyEn,
      bodyTh: input.bodyTh,
      publishedByAdminId: session.id,
    })
    .returning();

  if (!row) return { ok: false, code: "INVALID_INPUT" };

  revalidateSettings();
  // The customer buy screen reads the active terms server-side.
  revalidatePath("/buy");

  return {
    ok: true,
    version: {
      id: row.id,
      version: row.version,
      bodyEn: row.bodyEn,
      bodyTh: row.bodyTh,
      publishedAt: row.publishedAt,
      publishedByAdminId: row.publishedByAdminId,
    },
  };
}

// ───────────────────────── studio info ─────────────────────────

export type GetStudioInfoFailureCode = "UNAUTHORIZED";
export type GetStudioInfoResult =
  | { ok: true; info: StudioInfo }
  | { ok: false; code: GetStudioInfoFailureCode };

export async function getStudioInfo(): Promise<GetStudioInfoResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };
  return { ok: true, info: await loadStudioInfo() };
}

const SHORT_TEXT = z.string().trim().max(200);
const LONG_TEXT = z.string().trim().max(1_000);

const updateStudioInfoInput = z.object({
  nameEn: SHORT_TEXT.min(1),
  nameTh: SHORT_TEXT.min(1),
  addressEn: LONG_TEXT,
  addressTh: LONG_TEXT,
  phone: SHORT_TEXT,
  // Stored only when it is a real http(s) URL — an empty string clears it. This is
  // rendered as a link in the customer app, so a `javascript:`/`data:` scheme must
  // never survive validation.
  mapUrl: z
    .union([z.literal(""), z.string().trim().url()])
    .refine((v) => v === "" || /^https?:\/\//i.test(v), { message: "http(s) only" }),
  hoursEn: LONG_TEXT,
  hoursTh: LONG_TEXT,
});
export type UpdateStudioInfoInput = z.infer<typeof updateStudioInfoInput>;

export type UpdateStudioInfoFailureCode = "UNAUTHORIZED" | "INVALID_INPUT" | MockNoDbCode;
export type UpdateStudioInfoResult =
  | { ok: true; info: StudioInfo }
  | { ok: false; code: UpdateStudioInfoFailureCode };

/**
 * Upsert the single studio-info row (id pinned to 'default', CHECK-enforced, so
 * this can never create a second row).
 */
export async function updateStudioInfo(
  raw: UpdateStudioInfoInput,
): Promise<UpdateStudioInfoResult> {
  if (!(await requireOwner())) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = updateStudioInfoInput.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT" };
  const input = parsed.data;

  if (mockDataMode()) return { ok: false, code: "MOCK_NO_DB" };

  const mapUrl = input.mapUrl === "" ? null : input.mapUrl;
  const values = {
    nameEn: input.nameEn,
    nameTh: input.nameTh,
    addressEn: input.addressEn,
    addressTh: input.addressTh,
    phone: input.phone,
    mapUrl,
    hoursEn: input.hoursEn,
    hoursTh: input.hoursTh,
  };

  const db = getDb();
  await db
    .insert(studioSettings)
    .values({ id: STUDIO_SETTINGS_ID, ...values })
    .onConflictDoUpdate({
      target: studioSettings.id,
      set: { ...values, updatedAt: new Date() },
    });

  revalidateSettings();

  return {
    ok: true,
    info: {
      name: { en: input.nameEn, th: input.nameTh },
      address: { en: input.addressEn, th: input.addressTh },
      phone: input.phone,
      mapUrl,
      hours: { en: input.hoursEn, th: input.hoursTh },
    },
  };
}

/** Every admin surface that renders settings data. */
function revalidateSettings(): void {
  revalidatePath("/admin/settings");
  revalidatePath("/admin/settings/terms");
  revalidatePath("/admin/settings/studio");
}
