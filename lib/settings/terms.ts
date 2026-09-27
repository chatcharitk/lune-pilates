// The studio's purchase Terms & Conditions — the text a customer must tick to
// accept before any charge is opened (app/actions/purchase.ts → createCheckout).
//
// Storage model (see the `terms_versions` table doc in lib/db/schema.ts): rows are
// APPEND-ONLY. Publishing an edit inserts a NEW row with `version + 1`; nothing is
// ever updated or deleted. The ACTIVE version is the highest `version`. A charge
// stores the id of the version its customer actually ticked, so past purchases keep
// their verbatim terms no matter how many times the owner rewrites them afterwards.
//
// Mirrors the loadCatalogMap / loadVisibilityWindows convention: the table is
// authoritative once populated; SEED_TERMS below is only the seed + the
// empty-table/no-DB fallback, so the buy flow can never be blocked by an unseeded
// database (a customer must always have SOMETHING to read and accept).

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { termsAcceptances, termsVersions } from "@/lib/db/schema";
import { mockDataMode } from "@/lib/mock-mode";

/**
 * Which document (2026-09-27). `purchase` is accepted at checkout, once per charge.
 * `booking` is the studio's class rules, accepted when booking, once per user per
 * version.
 */
export type TermsKind = "purchase" | "booking";

/** One published, immutable revision of a terms document. */
export interface TermsVersion {
  /** The row id a charge stores as its consent record. */
  id: string;
  /** Monotonic, human-facing revision number (rendered as "v3"). */
  version: number;
  bodyEn: string;
  bodyTh: string;
  publishedAt: Date;
  publishedByAdminId: string | null;
}

/**
 * The seed / no-DB fallback terms. Most of it restates policies already enforced in
 * code (CLAUDE.md §5): one credit per class, the fixed 6-hour cancellation
 * window, non-transferable guest packages, shared household credits, and package
 * expiry.
 *
 * Clause 2 is different — it is the OWNER'S commercial policy, stated at her
 * request (2026-09-07): no refunds, no exchanges, and no expiry extension in any
 * case. It matches what the code actually does today: no action anywhere writes
 * `packages.expiresAt` after a package is created, and there is no money-refund or
 * package-exchange path at all. (The owner CAN still hand back classes as a goodwill
 * gesture via adjustCredits — that is a manual ledger adjustment, not a refund or an
 * extension, and it does not contradict this clause.) If an extend-expiry or refund
 * tool is ever built for the front desk, revisit this clause alongside it.
 *
 * Deliberately plain-language and conservative — the owner can replace any of it
 * with the studio's own wording via Settings → Terms & Conditions, which publishes
 * v2 and supersedes this everywhere.
 *
 * Its synthetic id is stable so a consent recorded against the fallback in a
 * no-DB/demo environment is still identifiable as "the seed text".
 */
export const SEED_TERMS: TermsVersion = {
  id: "00000000-0000-0000-0000-000000000001",
  version: 1,
  publishedAt: new Date("2026-01-01T00:00:00Z"),
  publishedByAdminId: null,
  bodyEn: [
    "1. Classes and validity",
    "Classes purchased are credited to your account once the studio has verified your payment. Each package is valid for the period stated at purchase, counted from the day the classes are added, and stays usable for the whole of its final day. For example, a 15-day package credited on 1 September can be used up to and including 16 September. Unused classes expire at the end of that day.",
    "",
    "2. No refunds, no exchanges, no extensions",
    "All purchases are final. A package cannot be returned or refunded, in whole or in part, and cannot be exchanged for a different package, for another service, or for cash. Package expiry cannot be extended under any circumstances — including illness, injury, pregnancy, travel, or any other reason — and unused classes are forfeited when the package expires.",
    "",
    "3. Booking",
    "Booking a class deducts one class from your balance, whichever type it is. It is deducted at the moment the booking is confirmed.",
    "",
    "4. Sharing",
    "Member packages are shared across everyone registered to the same household and may be used by any of them. Guest packages belong to the individual who purchased them and cannot be transferred, shared, or resold.",
    "",
    "5. Cancellation",
    "You may cancel a booking yourself up to 6 hours before the class begins, and the class will be returned to your balance in full. Within 6 hours of the class, bookings can no longer be cancelled online and the class is forfeited. Please contact the studio directly if you need help with a late change.",
    "",
    "6. Waitlist",
    "Joining a waitlist is free and does not reserve a place. If a space opens, we will notify you and you will have a short window to book it, but the space remains open to everyone until someone completes a booking.",
    "",
    "7. Classes cancelled by the studio",
    "If the studio cancels a class, it is returned to your balance in full.",
    "",
    "8. Payment",
    "Payments are made by PromptPay transfer and confirmed by the studio after your transfer slip has been checked. Classes are added only after that check.",
    "",
    "9. At the studio",
    "Please arrive a few minutes before your class begins. The studio may decline entry to a class that has already started. Let your instructor know about any injury, medical condition, or pregnancy before class so the session can be adapted safely.",
  ].join("\n"),
  bodyTh: [
    "1. คลาสและอายุการใช้งาน",
    "คลาสที่ซื้อจะถูกเพิ่มเข้าบัญชีของคุณเมื่อสตูดิโอตรวจสอบการชำระเงินเรียบร้อยแล้ว แต่ละแพ็กเกจมีอายุการใช้งานตามที่ระบุไว้ตอนซื้อ โดยเริ่มนับจากวันที่ได้รับคลาส และสามารถใช้ได้ตลอดทั้งวันสุดท้าย ตัวอย่างเช่น แพ็กเกจอายุ 15 วัน ที่ได้รับคลาสวันที่ 1 กันยายน จะใช้ได้ถึงวันที่ 16 กันยายน (รวมวันที่ 16 ด้วย) คลาสที่ไม่ได้ใช้จะหมดอายุเมื่อสิ้นสุดวันดังกล่าว",
    "",
    "2. ไม่รับคืน ไม่เปลี่ยน และไม่ขยายอายุ",
    "การซื้อทุกกรณีถือเป็นที่สิ้นสุด แพ็กเกจไม่สามารถขอคืนหรือขอคืนเงินได้ ไม่ว่าทั้งหมดหรือบางส่วน และไม่สามารถเปลี่ยนเป็นแพ็กเกจอื่น บริการอื่น หรือเงินสดได้ อายุการใช้งานของแพ็กเกจไม่สามารถขยายได้ไม่ว่ากรณีใด ๆ ทั้งสิ้น รวมถึงกรณีเจ็บป่วย บาดเจ็บ ตั้งครรภ์ เดินทาง หรือเหตุผลอื่นใด และคลาสที่ไม่ได้ใช้จะถือเป็นการสละสิทธิ์เมื่อแพ็กเกจหมดอายุ",
    "",
    "3. การจอง",
    "การจองคลาสจะหัก 1 คลาสจากยอดคงเหลือของคุณ ไม่ว่าจะเป็นคลาสประเภทใด โดยจะหักทันทีที่การจองสำเร็จ",
    "",
    "4. การใช้ร่วมกัน",
    "แพ็กเกจสำหรับสมาชิกสามารถใช้ร่วมกันได้ในกลุ่มบ้านเดียวกันที่ลงทะเบียนไว้ ส่วนแพ็กเกจสำหรับบุคคลทั่วไปเป็นสิทธิ์เฉพาะผู้ซื้อเท่านั้น ไม่สามารถโอน แบ่งใช้ หรือขายต่อได้",
    "",
    "5. การยกเลิก",
    "คุณสามารถยกเลิกการจองด้วยตนเองได้ก่อนคลาสเริ่มอย่างน้อย 6 ชั่วโมง และจะได้รับคลาสคืนเต็มจำนวน หากเหลือเวลาน้อยกว่า 6 ชั่วโมงก่อนคลาสเริ่ม จะไม่สามารถยกเลิกผ่านแอปได้และถือว่าสละสิทธิ์คลาสนั้น หากมีเหตุจำเป็นกรุณาติดต่อสตูดิโอโดยตรง",
    "",
    "6. รายชื่อรอคิว",
    "การเข้าคิวรอไม่มีค่าใช้จ่ายและไม่ถือเป็นการสำรองที่นั่ง หากมีที่ว่าง เราจะแจ้งให้คุณทราบและคุณจะมีเวลาช่วงสั้น ๆ ในการจอง แต่ที่นั่งนั้นยังเปิดให้ทุกคนจองได้จนกว่าจะมีผู้จองสำเร็จ",
    "",
    "7. กรณีสตูดิโอยกเลิกคลาส",
    "หากสตูดิโอเป็นฝ่ายยกเลิกคลาส คลาสที่ใช้จองนั้นจะถูกคืนเข้าบัญชีของคุณเต็มจำนวน",
    "",
    "8. การชำระเงิน",
    "ชำระเงินผ่าน PromptPay และสตูดิโอจะยืนยันหลังจากตรวจสอบสลิปการโอนของคุณแล้ว คลาสจะถูกเพิ่มเข้าบัญชีหลังการตรวจสอบเท่านั้น",
    "",
    "9. ข้อปฏิบัติที่สตูดิโอ",
    "กรุณามาถึงก่อนคลาสเริ่มเล็กน้อย สตูดิโออาจสงวนสิทธิ์ไม่ให้เข้าคลาสที่เริ่มไปแล้ว และกรุณาแจ้งครูผู้สอนก่อนเริ่มคลาสหากมีอาการบาดเจ็บ โรคประจำตัว หรืออยู่ระหว่างตั้งครรภ์ เพื่อปรับคลาสให้ปลอดภัยกับคุณ",
  ].join("\n"),
};

/**
 * The seed booking rules — the owner's own four, word for word in Thai (2026-09-27).
 *
 * The cancellation clause restates FREE_CANCEL_HOURS (6), which the server enforces;
 * the other three are conduct at the studio, which the app cannot enforce and can
 * only make sure every customer has read. Editable from Settings → Booking terms.
 */
export const SEED_BOOKING_TERMS: TermsVersion = {
  id: "00000000-0000-0000-0000-000000000002",
  version: 1,
  publishedAt: new Date("2026-09-27T00:00:00Z"),
  publishedByAdminId: null,
  bodyEn: [
    "• Cancel at least 6 hours before your class starts and the class is returned to your balance.",
    "• Please arrive at the studio 10 minutes before your class begins.",
    "• If you arrive more than 10 minutes late, the studio reserves the right not to admit you to the class, for your own safety.",
    "• Wear grip socks throughout the class.",
  ].join("\n"),
  bodyTh: [
    "• ยกเลิกคลาสก่อนคลาสเริ่ม 6 ชม. จะไม่ถูกตัดคลาส",
    "• กรุณาถึงสตูก่อนคลาสเริ่ม 10 นาที",
    "• กรณีที่เข้าคลาสช้าเกิน 10 นาที ขอสงวนสิทธิ์ไม่อนุญาตให้เข้าคลาส เพื่อความปลอดภัยของตัวผู้เล่น",
    "• สวมถุงเท้ากันลื่นตลอดการเข้าคลาส",
  ].join("\n"),
};

/** The fallback for a document nobody has published yet. */
export function seedTermsFor(kind: TermsKind): TermsVersion {
  return kind === "booking" ? SEED_BOOKING_TERMS : SEED_TERMS;
}

type TermsRow = typeof termsVersions.$inferSelect;

function rowToTerms(row: TermsRow): TermsVersion {
  return {
    id: row.id,
    version: row.version,
    bodyEn: row.bodyEn,
    bodyTh: row.bodyTh,
    publishedAt: row.publishedAt,
    publishedByAdminId: row.publishedByAdminId,
  };
}

/**
 * The ACTIVE version of `kind` — its highest `version`, or its seed when none has
 * been published / there is no database. Never returns null: a customer always has
 * something to read and accept.
 *
 * FILTERED BY KIND, which is the whole point: the table now holds two documents,
 * and "the highest version in the table" would let a booking-rules v4 quietly
 * become the terms every checkout binds its consent to.
 */
export async function loadActiveTerms(kind: TermsKind = "purchase"): Promise<TermsVersion> {
  if (mockDataMode()) return seedTermsFor(kind);

  const [row] = await getDb()
    .select()
    .from(termsVersions)
    .where(eq(termsVersions.kind, kind))
    .orderBy(desc(termsVersions.version))
    .limit(1);

  return row ? rowToTerms(row) : seedTermsFor(kind);
}

/** Every published version of `kind`, newest first — the admin history list. */
export async function loadTermsHistory(kind: TermsKind = "purchase"): Promise<TermsVersion[]> {
  if (mockDataMode()) return [seedTermsFor(kind)];

  const rows = await getDb()
    .select()
    .from(termsVersions)
    .where(eq(termsVersions.kind, kind))
    .orderBy(desc(termsVersions.version));
  return rows.length === 0 ? [seedTermsFor(kind)] : rows.map(rowToTerms);
}

/**
 * Whether `userId` has accepted this exact version. A seed version (no row) can never
 * have been recorded, so it always reads false — the customer is asked, and the
 * acceptance is recorded against the version the owner actually published.
 */
export async function hasAcceptedTerms(userId: string, termsVersionId: string): Promise<boolean> {
  if (mockDataMode()) return false;
  const [row] = await getDb()
    .select({ userId: termsAcceptances.userId })
    .from(termsAcceptances)
    .where(
      and(
        eq(termsAcceptances.userId, userId),
        eq(termsAcceptances.termsVersionId, termsVersionId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Record that `userId` accepted `termsVersionId`. Idempotent: accepting twice is a
 * no-op, so a retried booking cannot fail on the consent write.
 */
export async function recordTermsAcceptance(userId: string, termsVersionId: string): Promise<void> {
  if (mockDataMode()) return;
  await getDb()
    .insert(termsAcceptances)
    .values({ userId, termsVersionId })
    .onConflictDoNothing();
}

export type BookingTermsGate =
  | { ok: true }
  /** No acceptance on file and none sent with this request. */
  | { ok: false; code: "TERMS_NOT_ACCEPTED" }
  /** The customer accepted a version the owner has since replaced. */
  | { ok: false; code: "TERMS_OUTDATED" };

/**
 * Decide whether `userId` may book under the CURRENT booking rules, recording their
 * acceptance when this request carries it.
 *
 * - Already accepted this version → through, with nothing sent (the regular case).
 * - Sent the current version's id → recorded now, then through.
 * - Sent an older id → TERMS_OUTDATED: the owner published new rules while the
 *   customer had the sheet open, and they have not seen the new text.
 * - Sent nothing → TERMS_NOT_ACCEPTED.
 *
 * The screen asks first; this is what makes asking mean something (CLAUDE.md §8).
 */
export async function gateBookingTerms(
  userId: string,
  sentVersionId: string | undefined,
): Promise<BookingTermsGate> {
  const terms = await loadActiveTerms("booking");
  if (await hasAcceptedTerms(userId, terms.id)) return { ok: true };
  if (sentVersionId === undefined) return { ok: false, code: "TERMS_NOT_ACCEPTED" };
  if (sentVersionId !== terms.id) return { ok: false, code: "TERMS_OUTDATED" };
  // The seed has no row to reference, so it cannot be recorded — the customer is
  // simply asked again next time, until the owner publishes the rules as a real
  // version (which Settings does on first save).
  if (terms.id !== SEED_BOOKING_TERMS.id) await recordTermsAcceptance(userId, terms.id);
  return { ok: true };
}
