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
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userTier = pgEnum("user_tier", ["member", "guest"]);
// One credit pool per class format (2026-09-08). 1:1, Duo and Trio used to share a
// single "private" pool, so a ฿1,500/class 1:1 pack could book ฿2,000/class Trio
// classes; each now has its own balance, usable only for its own class type.
export const packageCategory = pgEnum("package_category", [
  "group",
  "private",
  "duo",
  "trio",
  "rental",
]);
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
    // NULLABLE = DORMANT (bundles, 2026-09-08). A package whose clock has not
    // started yet has NO expiry: the free group class in the trial bundle only
    // begins its 7 days once the paid private class has been taken.
    //
    // Null is deliberately chosen as the dormant marker because every existing
    // bookable/balance query filters `expires_at > now()`, and SQL comparisons
    // against NULL are never true — so a dormant package is invisible to the
    // booking engine, the balance, and the pool total with NO query changes and
    // no chance of a missed gate. It FAILS CLOSED.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // Usable FROM this instant (null = usable as soon as it has an expiry). Set
    // when a dormant component activates: the sibling's class start time. Gates
    // the window's near edge the way expires_at gates the far edge.
    activatesAt: timestamp("activates_at", { withTimezone: true }),
    // ── bundle wiring (see catalog_item_components) ──
    // Which component of the catalog item this row was created from. 'main' for an
    // ordinary single-balance package, so the composite UNIQUE below still dedupes
    // them (a NULL would not — Postgres treats NULLs as distinct).
    componentKey: text("component_key").notNull().default("main"),
    // The sibling package whose consumption starts THIS package's clock. Null for
    // anything that starts counting at purchase.
    activationAnchorPackageId: uuid("activation_anchor_package_id"),
    // How long this package lasts ONCE ACTIVATED (amount + 'day'|'month'). Only set
    // on a dormant/anchored package; a purchase-anchored one had its expiry stamped
    // at credit time and needs no window to apply later.
    activationAmount: integer("activation_amount"),
    activationUnit: text("activation_unit"),
    // The booking that actually started this package's clock. Kept so cancelling
    // that booking can put the package BACK to dormant — otherwise a customer could
    // book the anchor class to unlock the free one, then cancel the anchor and keep
    // the unlocked credit. Null while dormant and for everything non-anchored.
    activationBookingId: uuid("activation_booking_id"),
    ownerHouseholdId: uuid("owner_household_id").references(() => households.id),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    // The PromptPay charge this package was credited from. Nullable: admin/POS or
    // seeded packages may have no associated charge. UNIQUE per (charge, component)
    // — see the constraint below.
    purchaseChargeId: text("purchase_charge_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "package_single_owner",
      sql`(${t.ownerHouseholdId} is not null) <> (${t.ownerUserId} is not null)`,
    ),
    check("package_hours_left_nonneg", sql`${t.hoursLeft} >= 0`),
    // Purchase idempotency: confirming the same charge twice must never create a
    // second balance. A BUNDLE legitimately creates one row per component, so the
    // key is (charge, component) rather than the charge alone — 'main' being the
    // component of an ordinary package keeps single-balance items deduped exactly
    // as the old single-column UNIQUE did.
    uniqueIndex("packages_charge_component_key").on(t.purchaseChargeId, t.componentKey),
  ],
);

// ───────────────────────── catalog items (EDITABLE purchasable catalog) ─────────────────────────
// The studio owner's purchasable package catalog. Mirrors the class_templates
// pattern: the DB is authoritative once populated, and the hardcoded SEED_CATALOG
// (lib/catalog/packages.ts) is only the seed + the empty-table fallback.
//
// `id` is a STABLE SLUG (e.g. "p10", "pv8"), not a uuid: it is already the value
// stored in `packages.type` and `charges.package_id`, so it must never change and
// items are NEVER hard-deleted — only archived (active=false) — or historical
// charges and unspent credits would stop resolving.
//
// `per_hour` and `sublabel` are deliberately NOT stored: both are derived
// (per_hour = price / hours; sublabel = the validity label). Money is integer THB.
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: text("id").primaryKey(),
    // Immutable after creation: it decides which credit bucket a booking debits,
    // so changing it would corrupt existing balances (enforced in the action).
    category: packageCategory("category").notNull(),
    hours: integer("hours").notNull(),
    price: integer("price").notNull(), // THB, integer (no minor units / floats)
    // DEAD legacy column (kept, not dropped — additive migration only). Superseded by
    // validity_amount + validity_unit (2026-07-23). New writes still stamp a
    // best-effort token here to satisfy its NOT NULL; reads prefer the structured pair
    // and only fall back to this text for pre-migration rows (validityFromRow).
    validity: text("validity").notNull(),
    // Structured validity (2026-07-23): a positive whole `amount` of `day`s or
    // `month`s. The single source of a package's lifetime for new rows.
    validityAmount: integer("validity_amount"),
    validityUnit: text("validity_unit"), // 'day' | 'month'
    tag: text("tag"), // popular | best_value | null
    labelEn: text("label_en").notNull(),
    labelTh: text("label_th").notNull(),
    active: boolean("active").notNull().default(true),
    // TRIAL OFFERS (2026-09-08): only purchasable by a customer with no prior paid
    // purchase. Enforced server-side in createCheckout, and such items are hidden
    // from the buy screen for anyone who no longer qualifies.
    firstPurchaseOnly: boolean("first_purchase_only").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("catalog_item_hours_positive", sql`${t.hours} > 0`),
    check("catalog_item_price_nonneg", sql`${t.price} >= 0`),
    // Structured validity is nullable (pre-migration rows), but when present it must
    // be a positive amount in a known unit.
    check(
      "catalog_item_validity_amount_positive",
      sql`${t.validityAmount} is null or ${t.validityAmount} > 0`,
    ),
    check(
      "catalog_item_validity_unit_valid",
      sql`${t.validityUnit} is null or ${t.validityUnit} in ('day','month')`,
    ),
  ],
);

// ───────────────────────── catalog item components (BUNDLES) ─────────────────────────
// Lets one purchasable catalog item grant SEVERAL separate balances, each with its
// own credit category and its own expiry clock (owner's request, 2026-09-08).
//
// The motivating offer: a ฿1,800 trial = one private (1:1) class usable within 14
// days of payment, PLUS one free group class usable within 7 days of that private
// class. Neither half fits the plain model — a purchase used to grant exactly one
// balance in one category with one expiry stamped at payment time.
//
// A component is one of those balances:
//   - `category` + `hours`  → which credit bucket, and how many whole credits.
//   - `validity_amount/unit` → how long it lasts ONCE ITS CLOCK STARTS.
//   - `anchor_component_key` → WHEN the clock starts. NULL means "at purchase"
//     (the ordinary case). Otherwise it names a SIBLING component; this component
//     stays DORMANT (packages.expires_at IS NULL — unusable and invisible to the
//     booking engine) until that sibling is spent on a class, and then runs its
//     window from that class's start time.
//
// An item with NO rows here behaves exactly as before: one implicit "main"
// component built from the item's own category/hours/validity. Every existing
// package is therefore untouched, and this table is purely additive.
export const catalogItemComponents = pgTable(
  "catalog_item_components",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => catalogItems.id),
    // Stable slug, unique within the item (e.g. "private", "free_group"). Written
    // onto every package this component creates, so a granted balance can always be
    // traced back to the rule that made it — and so bundle purchases stay idempotent.
    componentKey: text("component_key").notNull(),
    category: packageCategory("category").notNull(),
    hours: integer("hours").notNull(),
    validityAmount: integer("validity_amount").notNull(),
    validityUnit: text("validity_unit").notNull(), // 'day' | 'month'
    // NULL → the clock starts at purchase. Otherwise the sibling component whose
    // use starts it. A cycle here would leave both halves permanently dormant, so
    // the admin action rejects one (app/actions/admin-catalog.ts).
    anchorComponentKey: text("anchor_component_key"),
    sortOrder: integer("sort_order").notNull().default(0),
    labelEn: text("label_en").notNull(),
    labelTh: text("label_th").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.componentKey] }),
    check("catalog_component_hours_positive", sql`${t.hours} > 0`),
    check("catalog_component_validity_positive", sql`${t.validityAmount} > 0`),
    check(
      "catalog_component_validity_unit_valid",
      sql`${t.validityUnit} in ('day','month')`,
    ),
    // A component anchored to ITSELF could never activate.
    check(
      "catalog_component_anchor_not_self",
      sql`${t.anchorComponentKey} is null or ${t.anchorComponentKey} <> ${t.componentKey}`,
    ),
  ],
);

// ───────────────────────── visibility windows (owner-editable, per class type) ─────────────────────────
// Owner-configurable tiered-visibility lead time (CLAUDE.md §5 invariant 4),
// replacing the hardcoded DEFAULT_PUBLIC_LEAD_HOURS constant (lib/domain/types.ts).
// PK is the class type itself (mirrors how catalogItems.category reuses
// packageCategory) — exactly one row per type. Mirrors the class_templates /
// catalog_items pattern: this table is authoritative once populated; the hardcoded
// SEED_VISIBILITY_WINDOWS (lib/schedule/visibilityWindows.ts) is only the seed +
// the empty-table/no-DB fallback.
//
// Each tier gets its own `{amount, unit}` lead time — members typically see a
// class far earlier than guests. `leadHoursFor` (lib/schedule/visibilityWindows.ts)
// converts amount+unit to hours with a flat day=24/week=168/month=720 conversion
// (a UX visibility cutoff, not money — calendar-exactness does not matter here).
export const visibilityWindows = pgTable(
  "visibility_windows",
  {
    type: classType("type").primaryKey(),
    memberAmount: integer("member_amount").notNull(),
    memberUnit: text("member_unit").notNull(), // 'day' | 'week' | 'month'
    guestAmount: integer("guest_amount").notNull(),
    guestUnit: text("guest_unit").notNull(), // 'day' | 'week' | 'month'
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("visibility_window_member_amount_positive", sql`${t.memberAmount} > 0`),
    check("visibility_window_guest_amount_positive", sql`${t.guestAmount} > 0`),
    check(
      "visibility_window_member_unit_valid",
      sql`${t.memberUnit} in ('day','week','month')`,
    ),
    check(
      "visibility_window_guest_unit_valid",
      sql`${t.guestUnit} in ('day','week','month')`,
    ),
  ],
);

// ───────────────────────── terms & conditions (append-only versions) ─────────────────────────
// The studio's purchase Terms & Conditions, which every customer must tick to accept
// before a charge is opened (app/actions/purchase.ts → createCheckout).
//
// APPEND-ONLY BY DESIGN — this is the whole point of the table. An owner "editing"
// the T&C PUBLISHES A NEW ROW; existing rows are never updated or deleted. A charge
// stores the id of the exact version its customer ticked (charges.terms_version_id),
// so months later the studio can prove verbatim what that customer agreed to. If
// rows were mutable, an edit would retroactively rewrite the terms of every past
// purchase — the same hazard the charge terms-snapshot columns above exist to
// prevent, but for the legal text rather than the hours/price.
//
// The ACTIVE version is simply the highest `version`. SEED_TERMS
// (lib/settings/terms.ts) is the empty-table/no-DB fallback, mirroring the
// catalog_items / visibility_windows pattern.
export const termsVersions = pgTable("terms_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Monotonic, human-facing version number ("v3"). UNIQUE so two concurrent
  // publishes can never mint the same version — the loser retries.
  version: integer("version").notNull().unique(),
  bodyEn: text("body_en").notNull(),
  bodyTh: text("body_th").notNull(),
  // The owner who published it (free-text staff id, mirrors payment_slips'
  // reviewed_by_admin_id). Null for the seeded/imported first version.
  publishedByAdminId: text("published_by_admin_id"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
});

// ───────────────────────── studio info (single row) ─────────────────────────
// Owner-editable studio identity shown to customers (address, phone, hours). A
// SINGLE row pinned to id='default' — the CHECK constraint makes a second row
// impossible, so reads never have to pick between rows. SEED_STUDIO_INFO
// (lib/settings/studio.ts) is the empty-table/no-DB fallback.
export const studioSettings = pgTable(
  "studio_settings",
  {
    id: text("id").primaryKey().default("default"),
    nameEn: text("name_en").notNull(),
    nameTh: text("name_th").notNull(),
    addressEn: text("address_en").notNull(),
    addressTh: text("address_th").notNull(),
    phone: text("phone").notNull(),
    // A maps deep-link the customer app can open. Free-text; validated as an
    // http(s) URL server-side before it is ever stored (never rendered raw).
    mapUrl: text("map_url"),
    hoursEn: text("hours_en").notNull(),
    hoursTh: text("hours_th").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("studio_settings_single_row", sql`${t.id} = 'default'`)],
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
  // ── PURCHASED-TERMS SNAPSHOT (hours / validity / category) ──
  // The catalog is now OWNER-EDITABLE at runtime (catalog_items), so re-resolving the
  // item LIVE at approval time would let an edit made while a charge sits in
  // `awaiting_review` retroactively change what an already-paid charge grants (edit
  // p10 10h→20h and the front desk credits 20h for a ฿5,500 payment; 10h→5h
  // shortchanges the customer). These columns freeze the terms the customer actually
  // paid against, written at charge-creation time; crediting reads them, not the
  // live item. `amount` already froze the price — this completes the snapshot.
  //
  // NULLABLE by design: charges created BEFORE this column existed have no snapshot,
  // and the credit paths fall back to the live catalog item exactly as they did
  // before (see lib/catalog/chargeTerms.ts). New rows always write all three.
  hours: integer("hours"),
  validity: text("validity"),
  // Structured validity snapshot (2026-07-23) alongside the legacy `validity` text.
  // Nullable: pre-migration charges (and legacy-only new writes) leave them null and
  // fall back to `validity` text when credited (lib/catalog/chargeTerms.ts).
  validityAmount: integer("validity_amount"),
  validityUnit: text("validity_unit"), // 'day' | 'month'
  category: packageCategory("category"),
  // ── T&C CONSENT (2026-09-07) ──
  // The exact Terms & Conditions version the customer ticked to accept before this
  // charge was opened, and when. Written server-side at createCheckout time from the
  // ACTIVE version (the client sends which version it displayed; the server rejects
  // it as TERMS_OUTDATED if the owner published a newer one mid-flow, so a customer
  // can never be bound to text they did not see). Because terms_versions is
  // append-only, this reference is a permanent, verbatim record of what they agreed
  // to — it survives every later T&C edit.
  //
  // NULLABLE by design: charges opened BEFORE this column existed have no consent
  // record, and admin POS (front-desk, in-person) sales do not collect one.
  termsVersionId: uuid("terms_version_id").references(() => termsVersions.id),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  // ── PROMO SNAPSHOT (2026-09-12) ──
  // What the customer actually paid is `amount`; these record WHY it differs from
  // the catalog price. Frozen here for the same reason the terms and components are:
  // an owner editing or retiring a code must not change what an already-open charge
  // was billed, and the front desk needs the original price beside the code to match
  // a transfer slip. All null when no code was used.
  promoCode: text("promo_code"),
  promoDiscount: integer("promo_discount"),
  originalAmount: integer("original_amount"),
  // BUNDLE COMPONENTS SNAPSHOT (2026-09-08). JSON array of the components this
  // charge was opened against, frozen at checkout for exactly the reason the
  // hours/validity columns above are frozen: components are owner-editable at
  // runtime, and a charge can sit in `awaiting_review` for days. Re-resolving them
  // live at approval time would let an edit change what an already-paid purchase
  // grants. NULL for a plain single-balance item (nothing to freeze) and for
  // charges opened before bundles existed — both fall back to the live resolution.
  componentsJson: text("components_json"),
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

// ───────────────────────── promo codes (event discounts) ─────────────────────────
// Owner-created discount codes for studio events — pre-opening, soft opening,
// grand opening (2026-09-12). A customer types the code on the buy screen and the
// SERVER recomputes what they pay; the client only ever sends the string.
//
// `code` is the primary key and is stored UPPERCASE, so lookups are
// case-insensitive without a functional index and a code can never be duplicated
// with different casing.
export const promoCodes = pgTable(
  "promo_codes",
  {
    code: text("code").primaryKey(),
    labelEn: text("label_en").notNull(),
    labelTh: text("label_th").notNull(),
    // DEAD legacy columns (2026-09-12): the discount moved to promo_code_rules so
    // one code can be worth different amounts per class format. Kept nullable
    // through the deploy window and dropped in drizzle/0012 — no longer read or
    // written. Same treatment catalog_items.validity got when it was superseded.
    kind: text("kind"),
    value: integer("value"),
    // Window bounds, both optional. `endsAt` is stored as the LAST USABLE INSTANT of
    // its Bangkok day, matching how package expiry works — the final day counts in full.
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** Total redemptions allowed across everyone ("first 30"). Null = unlimited. */
    maxRedemptions: integer("max_redemptions"),
    /** Redemptions allowed per customer. 1 stops one person draining a capped code. */
    maxPerCustomer: integer("max_per_customer").notNull().default(1),
    /** DEAD legacy column — superseded by promo_code_rules (see above). */
    appliesToCategory: packageCategory("applies_to_category"),
    /** Restrict to a single catalog item. Null = any. Narrower than the category. */
    appliesToItemId: text("applies_to_item_id").references(() => catalogItems.id),
    /** Same rule the trial uses: only customers with no prior paid purchase. */
    firstPurchaseOnly: boolean("first_purchase_only").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "promo_max_redemptions_positive",
      sql`${t.maxRedemptions} is null or ${t.maxRedemptions} > 0`,
    ),
    check("promo_max_per_customer_positive", sql`${t.maxPerCustomer} > 0`),
  ],
);

// What a code is worth, PER CLASS FORMAT (2026-09-12). One code can take ฿200 off a
// group pack and ฿500 off a 1:1, so the studio advertises a single code that behaves
// differently per format.
//
// A format with no row here is NOT covered by the code. That makes this table the
// single place that answers both "how much" and "which formats" — there is no
// separate restriction flag that could disagree with the amounts.
export const promoCodeRules = pgTable(
  "promo_code_rules",
  {
    code: text("code")
      .notNull()
      .references(() => promoCodes.code, { onDelete: "cascade" }),
    category: packageCategory("category").notNull(),
    /** 'percent' → `value` is 1–100; 'fixed' → `value` is whole THB off. */
    kind: text("kind").notNull(),
    value: integer("value").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.code, t.category] }),
    check("promo_rule_kind_valid", sql`${t.kind} in ('percent','fixed')`),
    check("promo_rule_value_positive", sql`${t.value} > 0`),
    check(
      "promo_rule_percent_within_100",
      sql`${t.kind} <> 'percent' or ${t.value} <= 100`,
    ),
  ],
);

// One row per charge that used a code. `chargeId` is the PRIMARY KEY, which is what
// makes redemption counting idempotent: a retried or double-submitted checkout
// cannot consume a second slot of a capped code.
//
// Rows are never deleted — they are the audit trail of who redeemed what. A
// cancelled or rejected charge is instead EXCLUDED when counting against the cap
// (see lib/promos/codes.ts), so abandoning a checkout hands the slot back.
export const promoRedemptions = pgTable("promo_redemptions", {
  chargeId: text("charge_id")
    .primaryKey()
    .references(() => charges.chargeId),
  code: text("code")
    .notNull()
    .references(() => promoCodes.code),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  /** THB taken off, frozen at checkout — never recomputed from the live code. */
  discountAmount: integer("discount_amount").notNull(),
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
  /**
   * Profile photo as a `data:image/...;base64,…` URL, or null for the initial-letter
   * avatar (2026-09-10).
   *
   * Held IN THE ROW rather than in object storage on purpose: the studio has a
   * handful of instructors, the upload is downscaled to a small square before it
   * ever leaves the browser (~20–40KB), and a data URL renders everywhere with no
   * public bucket, no signed-URL plumbing and no second failure mode. If the roster
   * ever grows large enough for this to weigh on queries, move it to the storage
   * adapter and keep a key here — the column is deliberately the only thing that
   * would need to change.
   */
  photoUrl: text("photo_url"),
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
  // Optional custom display name set by the owner; null → the type label is shown.
  name: text("name"),
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
  // Optional custom display name (copied from the template on generate, or set per
  // class in the admin schedule editor); null → the type label is shown.
  name: text("name"),
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
    freeCancelHours: integer("free_cancel_hours").notNull().default(6),
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
