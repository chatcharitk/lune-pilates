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

import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { termsVersions } from "@/lib/db/schema";
import { mockDataMode } from "@/lib/mock-mode";

/** One published, immutable revision of the purchase terms. */
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
 * The seed / no-DB fallback terms, restating the policies already encoded in the
 * app (CLAUDE.md §5): whole-hour credit costs, the fixed 5-hour cancellation
 * window, non-transferable guest packages, shared household credits, and package
 * expiry. Deliberately plain-language and conservative — the owner is expected to
 * replace it with the studio's own wording via Settings → Terms & Conditions,
 * which publishes v2 and supersedes this everywhere.
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
    "1. Credits and validity",
    "Hours purchased are credited to your account once the studio has verified your payment. Each package is valid for the period stated at purchase, counted from the date the credit is added. Unused hours expire at the end of that period and are not refundable or extendable.",
    "",
    "2. Booking and credit cost",
    "Booking a class deducts whole hours from your balance: 1 hour for a Group class or a Reformer rental, and 2 hours for a Private, Duo, or Trio class. Hours are deducted at the moment the booking is confirmed.",
    "",
    "3. Sharing",
    "Member packages are shared across everyone registered to the same household and may be used by any of them. Guest packages belong to the individual who purchased them and cannot be transferred, shared, or resold.",
    "",
    "4. Cancellation",
    "You may cancel a booking yourself up to 5 hours before the class begins, and the hours will be returned to your balance in full. Within 5 hours of the class, bookings can no longer be cancelled online and the hours are forfeited. Please contact the studio directly if you need help with a late change.",
    "",
    "5. Waitlist",
    "Joining a waitlist is free and does not reserve a place. If a space opens, we will notify you and you will have a short window to book it, but the space remains open to everyone until someone completes a booking.",
    "",
    "6. Classes cancelled by the studio",
    "If the studio cancels a class, all hours booked for it are returned to your balance in full.",
    "",
    "7. Payment",
    "Payments are made by PromptPay transfer and confirmed by the studio after your transfer slip has been checked. Credits are added only after that check.",
    "",
    "8. At the studio",
    "Please arrive a few minutes before your class begins. The studio may decline entry to a class that has already started. Let your instructor know about any injury, medical condition, or pregnancy before class so the session can be adapted safely.",
  ].join("\n"),
  bodyTh: [
    "1. ชั่วโมงเรียนและอายุการใช้งาน",
    "ชั่วโมงที่ซื้อจะถูกเพิ่มเข้าบัญชีของคุณเมื่อสตูดิโอตรวจสอบการชำระเงินเรียบร้อยแล้ว แต่ละแพ็กเกจมีอายุการใช้งานตามที่ระบุไว้ตอนซื้อ โดยเริ่มนับจากวันที่ได้รับชั่วโมง ชั่วโมงที่ไม่ได้ใช้จะหมดอายุเมื่อครบกำหนด ไม่สามารถขอคืนเงินหรือขอต่ออายุได้",
    "",
    "2. การจองและการหักชั่วโมง",
    "การจองคลาสจะหักชั่วโมงจากยอดคงเหลือของคุณเป็นจำนวนเต็มชั่วโมง ได้แก่ 1 ชั่วโมงสำหรับคลาสกลุ่มและการเช่าเครื่อง Reformer และ 2 ชั่วโมงสำหรับคลาสส่วนตัว คลาสคู่ และคลาสสามคน โดยจะหักทันทีที่การจองสำเร็จ",
    "",
    "3. การใช้ร่วมกัน",
    "แพ็กเกจสำหรับสมาชิกสามารถใช้ร่วมกันได้ในกลุ่มบ้านเดียวกันที่ลงทะเบียนไว้ ส่วนแพ็กเกจสำหรับบุคคลทั่วไปเป็นสิทธิ์เฉพาะผู้ซื้อเท่านั้น ไม่สามารถโอน แบ่งใช้ หรือขายต่อได้",
    "",
    "4. การยกเลิก",
    "คุณสามารถยกเลิกการจองด้วยตนเองได้ก่อนคลาสเริ่มอย่างน้อย 5 ชั่วโมง และจะได้รับชั่วโมงคืนเต็มจำนวน หากเหลือเวลาน้อยกว่า 5 ชั่วโมงก่อนคลาสเริ่ม จะไม่สามารถยกเลิกผ่านแอปได้และถือว่าสละสิทธิ์ชั่วโมงนั้น หากมีเหตุจำเป็นกรุณาติดต่อสตูดิโอโดยตรง",
    "",
    "5. รายชื่อรอคิว",
    "การเข้าคิวรอไม่มีค่าใช้จ่ายและไม่ถือเป็นการสำรองที่นั่ง หากมีที่ว่าง เราจะแจ้งให้คุณทราบและคุณจะมีเวลาช่วงสั้น ๆ ในการจอง แต่ที่นั่งนั้นยังเปิดให้ทุกคนจองได้จนกว่าจะมีผู้จองสำเร็จ",
    "",
    "6. กรณีสตูดิโอยกเลิกคลาส",
    "หากสตูดิโอเป็นฝ่ายยกเลิกคลาส ชั่วโมงที่ใช้จองคลาสนั้นจะถูกคืนเข้าบัญชีของคุณเต็มจำนวน",
    "",
    "7. การชำระเงิน",
    "ชำระเงินผ่าน PromptPay และสตูดิโอจะยืนยันหลังจากตรวจสอบสลิปการโอนของคุณแล้ว ชั่วโมงจะถูกเพิ่มเข้าบัญชีหลังการตรวจสอบเท่านั้น",
    "",
    "8. ข้อปฏิบัติที่สตูดิโอ",
    "กรุณามาถึงก่อนคลาสเริ่มเล็กน้อย สตูดิโออาจสงวนสิทธิ์ไม่ให้เข้าคลาสที่เริ่มไปแล้ว และกรุณาแจ้งครูผู้สอนก่อนเริ่มคลาสหากมีอาการบาดเจ็บ โรคประจำตัว หรืออยู่ระหว่างตั้งครรภ์ เพื่อปรับคลาสให้ปลอดภัยกับคุณ",
  ].join("\n"),
};

/**
 * The ACTIVE terms version — the highest `version` in the table, or SEED_TERMS
 * when the table is empty / there is no database. Never returns null: the buy
 * flow always has terms to display and bind a consent to.
 */
export async function loadActiveTerms(): Promise<TermsVersion> {
  if (mockDataMode()) return SEED_TERMS;

  const db = getDb();
  const [row] = await db
    .select()
    .from(termsVersions)
    .orderBy(desc(termsVersions.version))
    .limit(1);

  if (!row) return SEED_TERMS;
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
 * Every published version, newest first — the admin history list. Returns the
 * seed alone when nothing has been published yet.
 */
export async function loadTermsHistory(): Promise<TermsVersion[]> {
  if (mockDataMode()) return [SEED_TERMS];

  const db = getDb();
  const rows = await db.select().from(termsVersions).orderBy(desc(termsVersions.version));
  if (rows.length === 0) return [SEED_TERMS];
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    bodyEn: row.bodyEn,
    bodyTh: row.bodyTh,
    publishedAt: row.publishedAt,
    publishedByAdminId: row.publishedByAdminId,
  }));
}
