// Drizzle schema for LUNE Pilates. Models the domain in CLAUDE.md §5.
// The CreditLedger is append-only and is the source of truth for balances;
// packages.hours_left is a cache that must always reconcile to the ledger.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userTier = pgEnum("user_tier", ["member", "guest"]);
export const packageCategory = pgEnum("package_category", ["group", "private", "rental"]);
export const classType = pgEnum("class_type", ["group", "private", "duo", "trio", "rental"]);
export const classStatus = pgEnum("class_status", ["draft", "published", "cancelled"]);
export const bookingStatus = pgEnum("booking_status", ["booked", "cancelled"]);
export const waitlistStatus = pgEnum("waitlist_status", ["waiting", "offered", "claimed", "expired"]);
export const reformerPosition = pgEnum("reformer_position", ["left", "middle", "right"]);

// ───────────────────────── households & users ─────────────────────────
export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  houseNumber: text("house_number").notNull().unique(),
  ownerUserId: uuid("owner_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull().unique(),
  name: text("name").notNull(),
  tier: userTier("tier").notNull().default("guest"),
  householdId: uuid("household_id").references(() => households.id),
  lineUserId: text("line_user_id").unique(),
  // The member's LINE profile photo URL (from LIFF login), refreshed on each login.
  // Null until they sign in via LINE; the UI falls back to an initial.
  linePictureUrl: text("line_picture_url"),
  // Soft-delete flag. An admin "remove customer" flips this false (and anonymises PII
  // + unlinks LINE) rather than deleting the row — the append-only ledger and the
  // financial history reference this id and must be preserved for the books.
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ───────────────────────── packages (balance holders) ─────────────────────────
// Exactly one owner: household_id (member, sharable) XOR user_id (guest, non-transferable).
export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(), // catalog item id, e.g. "p10", "pv8"
    category: packageCategory("category").notNull(),
    // Credit balances are whole integer credits (1 group/rental, 2 private/duo/trio).
    hoursTotal: integer("hours_total").notNull(),
    hoursLeft: integer("hours_left").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ownerHouseholdId: uuid("owner_household_id").references(() => households.id),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    // The PromptPay charge this package was credited from. UNIQUE so confirming
    // the same charge twice can never create a second package / double-credit
    // (purchase idempotency — see app/actions/purchase.ts). Nullable: admin/POS
    // or seeded packages may have no associated charge.
    purchaseChargeId: text("purchase_charge_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "package_single_owner",
      sql`(${t.ownerHouseholdId} is not null) <> (${t.ownerUserId} is not null)`,
    ),
    check("package_hours_left_nonneg", sql`${t.hoursLeft} >= 0`),
  ],
);

// ───────────────────────── charges (purchase intent) ─────────────────────────
// Server-side binding of a PromptPay charge → exactly what it pays for. Written at
// createCheckout time from the catalog item + session user (never the client), and
// is the AUTHORITATIVE source for hours/price/owner/recipient at confirmPayment time
// (CLAUDE.md §8 — money is recomputed server-side, never trusted from the client).
// A client may submit a packageId on confirm, but it is validated against the stored
// binding; the catalog item that is actually credited is resolved from `packageId`
// here, so a cheap charge can never confirm an expensive package.
export const charges = pgTable("charges", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The provider's charge id (PromptPay). UNIQUE so each charge binds to one intent.
  chargeId: text("charge_id").notNull().unique(),
  // Catalog item id (packages.type, e.g. "p10") this charge pays for — resolved
  // server-side from the catalog at checkout. Crediting reads the item from THIS.
  packageId: text("package_id").notNull(),
  // The user who opened the charge. Only this user may confirm it (else FORBIDDEN).
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  // THB amount the charge was opened for — from the catalog, integer (no floats).
  amount: integer("amount").notNull(),
  // Opaque reference tying charge → user + item + instant (audit / provider match).
  reference: text("reference").notNull(),
  // How the sale was tendered: "promptpay" (QR, the default — customer self-serve
  // and admin POS) | "cash" (admin POS, taken at the front desk). The customer
  // self-purchase flow only ever opens "promptpay"; the admin POS may record either.
  // A cash sale is credited immediately at status="paid"; PromptPay credits on
  // confirm. (Card is OUT of scope for v1 — see app/actions/admin-pos.ts.)
  method: text("method").notNull().default("promptpay"),
  // Lifecycle of the intent (CLAUDE.md §5 — slip-verification, Feature 3):
  //   pending          → QR shown, awaiting payment;
  //   awaiting_review   → customer uploaded a slip (uploadPaymentSlip);
  //   paid             → admin approved the slip (approveSlip credits ONCE here);
  //   rejected         → admin rejected the slip (no credit; re-upload allowed).
  // The CASH POS path still flips straight to "paid". The column stays free-text
  // (the new string values need no DDL); reads normalise via lib/admin/payments.ts.
  status: text("status").notNull().default("pending"),
  // When an admin made the approve/reject decision (Feature 3). Null until reviewed.
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  // Why a slip was rejected (admin note shown back to the customer). Null unless rejected.
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ───────────────────────── payment slips (PromptPay verification) ─────────────────────────
// A customer-uploaded PromptPay transfer slip awaiting admin verification (Feature
// 3). Exactly ONE slip per charge (chargeId UNIQUE) — a re-upload after rejection
// UPSERTs this row back to a fresh awaiting_review state. The image is held as a
// base64 data-URL (the v1 mock store; STORAGE_MODE swaps in a real object store with
// no logic change). Slip images contain bank/PII and are served ONLY behind
// requireAdmin (app/actions/admin-payments.ts → getSlip).
export const paymentSlips = pgTable("payment_slips", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The charge this slip pays for. UNIQUE so a charge has at most one live slip; a
  // re-upload after reject replaces this row (UPSERT on conflict).
  chargeId: text("charge_id")
    .notNull()
    .unique()
    .references(() => charges.chargeId),
  // The slip image as a `data:<mime>;base64,…` URL. NULLABLE by design: the mock store
  // persists the image HERE (the column IS its store), but a real object store (Vercel
  // Blob / S3) holds the bytes itself and leaves this null, resolving via storageKey.
  // put() tells the caller which: dataUrlToPersist = the URL (mock) or null (real store).
  dataUrl: text("data_url"),
  // Opaque key the storage adapter returns (the chargeId for the mock). Resolves the
  // image back via getSlipStorage().get — never a public URL.
  storageKey: text("storage_key").notNull(),
  // Sniffed mime type (image/jpeg | image/png | image/webp) — validated server-side.
  mimeType: text("mime_type").notNull(),
  // Decoded image size in bytes (≤ 5 MB, enforced server-side at upload).
  sizeBytes: integer("size_bytes").notNull(),
  // The customer who uploaded the slip — must be the charge's bound owner (FORBIDDEN
  // otherwise). Stamped server-side from the session, never the client.
  uploadedByUserId: uuid("uploaded_by_user_id")
    .notNull()
    .references(() => users.id),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  // The admin who reviewed (free-text staff id, mirrors admin auth's session id).
  // Null until reviewed.
  reviewedByAdminId: text("reviewed_by_admin_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  // The decision: "approved" | "rejected". Null until reviewed.
  reviewDecision: text("review_decision"),
  // Optional admin note (e.g. rejection reason). Null unless supplied.
  reviewNote: text("review_note"),
});

// ───────────────────────── credit ledger (append-only) ─────────────────────────
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
    // −cost on book, +cost on free cancel, +N on purchase. Integer credits
    // (1 group/rental, 2 private/duo/trio) — whole numbers only.
    delta: integer("delta").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    bookingId: uuid("booking_id"),
    reason: text("reason").notNull(), // "booking" | "cancel_refund" | "purchase" | "promo" | "adjustment" | "purchase_cancelled"
    // Client-supplied retry token for manual owner adjustments (reason="adjustment")
    // so a dropped-response retry can't double-apply. Null for every other row; the
    // partial unique index dedupes only the non-null adjustment keys.
    idempotencyKey: text("idempotency_key"),
    // Free-text audit note (the owner's written reason on manual adjustments;
    // "class cancelled by studio" on class-level cancels). Null otherwise.
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("credit_ledger_idem_key")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);

// ───────────────────────── instructors ─────────────────────────
export const instructors = pgTable("instructors", {
  id: text("id").primaryKey(), // "mai", "ploy", "nina"
  name: text("name").notNull(),
  nameTh: text("name_th").notNull(),
  tag: text("tag"),
  active: boolean("active").notNull().default(true),
});

// ───────────────────────── instructor availability ─────────────────────────
// A recurring WEEKLY availability template per instructor (the source of truth for
// the admin "Instructors" editor — admin-mobile-more.jsx `MAvailEditor`). One row
// per working time-range on a weekday; "today's availability" = rows where
// day_of_week = today's ISO weekday. day_of_week matches classTemplates: 1=Mon … 7=Sun.
// Editing replaces ALL of an instructor's rows atomically (app/actions/instructors.ts).
export const instructorAvailability = pgTable(
  "instructor_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instructorId: text("instructor_id")
      .notNull()
      .references(() => instructors.id),
    dayOfWeek: integer("day_of_week").notNull(), // 1=Mon … 7=Sun
    startTime: text("start_time").notNull(), // "HH:MM" 24h
    endTime: text("end_time").notNull(), // "HH:MM" 24h, end > start
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("instr_avail_dow_range", sql`${t.dayOfWeek} between 1 and 7`)],
);

// ───────────────────────── schedule ─────────────────────────
// Recurring baseline template. Edits to a week never mutate this.
export const classTemplates = pgTable("class_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  dayOfWeek: integer("day_of_week").notNull(), // 1=Mon … 7=Sun
  time: text("time").notNull(), // "08:00"
  durationMin: integer("duration_min").notNull().default(60),
  type: classType("type").notNull(),
  capacity: integer("capacity").notNull(),
  instructorId: text("instructor_id").references(() => instructors.id),
  active: boolean("active").notNull().default(true),
});

export const classInstances = pgTable("class_instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").references(() => classTemplates.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  durationMin: integer("duration_min").notNull().default(60),
  type: classType("type").notNull(),
  capacity: integer("capacity").notNull(),
  instructorId: text("instructor_id").references(() => instructors.id),
  status: classStatus("status").notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  // computed on publish; members see at publishedAt, guests at publicVisibleAt
  membersVisibleAt: timestamp("members_visible_at", { withTimezone: true }),
  publicVisibleAt: timestamp("public_visible_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ───────────────────────── bookings ─────────────────────────
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classInstanceId: uuid("class_instance_id")
      .notNull()
      .references(() => classInstances.id),
    userId: uuid("user_id") // the actor who used the credit
      .notNull()
      .references(() => users.id),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
    position: reformerPosition("position"),
    // Credits actually debited for this booking (1 group/rental · 2 private·duo·trio).
    // Whole integer credits. This is the exact amount a free cancellation refunds
    // (CLAUDE.md §5 inv 7).
    creditCost: integer("credit_cost").notNull(),
    // The free cancellation window (hours before start). AUDIT STAMP only: the
    // policy is now a single FIXED window (FREE_CANCEL_HOURS = 5) for every booking
    // (CLAUDE.md §5 invariant 7, decided 2026-06-28), so this is always stamped 5 at
    // booking time and read back for the record — it is no longer a live per-booking
    // input. A cancel is free (and only allowed) when hoursUntilStart >= 5.
    freeCancelHours: integer("free_cancel_hours").notNull().default(5),
    status: bookingStatus("status").notNull().default("booked"),
    // Front-desk roster check-in (admin Today screen). Null = not yet checked in;
    // stamped with the instant the attendee was checked in. A booking is "checked
    // in" iff this is non-null — there is no separate boolean to drift from it.
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    // DB BACKSTOP for "one LIVE booking per (class, user)" (CLAUDE.md §5 inv 1,
    // audit LOW-1). The atomic debit already prevents a double-book via the class
    // FOR UPDATE + in-tx dupe check; this PARTIAL unique index is defense-in-depth
    // so a logic regression can never persist two live bookings for the same
    // person in the same class. Partial (status='booked') so cancelled rows — of
    // which there can be many for one (class,user) after re-books — don't collide.
    uniqueIndex("bookings_one_live_per_user")
      .on(t.classInstanceId, t.userId)
      .where(sql`${t.status} = 'booked'`),
    // DB BACKSTOP for "one LIVE booking per reformer position" — a position can be
    // held by at most one live booking in a class. Also partial on status='booked'
    // and only where a position is set (cap-1 Privates carry a null position).
    uniqueIndex("bookings_one_live_per_position")
      .on(t.classInstanceId, t.position)
      .where(sql`${t.status} = 'booked' and ${t.position} is not null`),
  ],
);

// ───────────────────────── waitlist ─────────────────────────
export const waitlist = pgTable(
  "waitlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classInstanceId: uuid("class_instance_id")
      .notNull()
      .references(() => classInstances.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    position: integer("position").notNull(),
    status: waitlistStatus("status").notNull().default("waiting"),
    offeredAt: timestamp("offered_at", { withTimezone: true }),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // DB BACKSTOP mirroring bookings_one_live_per_user: at most one LIVE queue
    // entry per (class, user). Partial on live statuses so historical
    // claimed/expired rows never collide (re-joining after expiry stays legal).
    uniqueIndex("waitlist_one_live_per_user")
      .on(t.classInstanceId, t.userId)
      .where(sql`${t.status} in ('waiting', 'offered')`),
  ],
);

export type DbPackage = typeof packages.$inferSelect;
export type DbClassInstance = typeof classInstances.$inferSelect;
export type DbBooking = typeof bookings.$inferSelect;
export type DbUser = typeof users.$inferSelect;
export type DbCharge = typeof charges.$inferSelect;
export type DbPaymentSlip = typeof paymentSlips.$inferSelect;
