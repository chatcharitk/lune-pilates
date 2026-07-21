// DB-backed integration tests for the admin package-catalog CRUD
// (app/actions/admin-catalog.ts).
//
// WHY THIS FILE EXISTS. The no-DB suite (tests/admin-catalog.test.ts) runs entirely
// in `mockDataMode()`, which short-circuits BEFORE the database is ever touched. That
// blind spot shipped a 100%-fatal bug: `nextSortOrder` built
//
//   SELECT max(sort_order) … WHERE category = ? ORDER BY sort_order
//
// — a bare aggregate with an ORDER BY on the un-aggregated column, which Postgres
// rejects outright ("column catalog_items.sort_order must appear in the GROUP BY
// clause or be used in an aggregate function"). The UI never sends `sortOrder`, so
// that helper ran on EVERY create, and it THREW rather than returning { ok:false } —
// so the primary write of the feature was dead in every DB-backed environment and the
// error toast never even fired. Not one mock test could see it.
//
// So: these specs exercise the actions against a REAL database. Anything that only
// fails in SQL — aggregates, constraints, uniqueness, the archive round-trip — belongs
// here, not in the mock suite.
//
// Gated on DATABASE_URL (loaded from .env by setup-env.ts); skips cleanly without it.
// Every fixture id is uniquely tagged and hard-deleted in afterAll. Deleting catalog
// rows is safe ONLY because these are throwaway items no charge or package references
// — production code must never hard-delete a catalog item (it archives instead).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";

// The DB paths call revalidatePath, which throws outside a Next request scope.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

import { getDb, closeDb } from "@/lib/db/client";
import { catalogItems } from "@/lib/db/schema";
import {
  archiveCatalogItem,
  createCatalogItem,
  listCatalogForAdmin,
  reorderCatalog,
  restoreCatalogItem,
  updateCatalogItem,
} from "@/app/actions/admin-catalog";
import { getCatalogItem } from "@/lib/catalog/packages";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("admin catalog CRUD (integration · requires DATABASE_URL)", () => {
  // Slug-safe unique prefix (SLUG_RE allows lowercase alphanumerics + hyphens).
  const tag = `zzit${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase();
  const created: string[] = [];

  const mkId = (suffix: string) => {
    const id = `${tag}-${suffix}`;
    created.push(id);
    return id;
  };

  const base = {
    category: "group" as const,
    hours: 10,
    price: 5500,
    validity: "two_months" as const,
    labelEn: "10 hours",
    labelTh: "10 ชั่วโมง",
  };

  beforeAll(() => {
    delete process.env.ADMIN_AUTH; // mock admin provider, default role = owner
    delete process.env.ADMIN_ROLE;
  });

  afterAll(async () => {
    try {
      const db = getDb();
      if (created.length) {
        await db.delete(catalogItems).where(inArray(catalogItems.id, created));
      }
      // Belt and braces: anything else this run's prefix left behind.
      await db.delete(catalogItems).where(like(catalogItems.id, `${tag}-%`));
    } finally {
      await closeDb();
    }
  });

  // ─────────────────── the C1 regression ───────────────────

  describe("createCatalogItem writes to the database", () => {
    it("REGRESSION: a create with NO sortOrder succeeds (the nextSortOrder aggregate is valid SQL)", async () => {
      // This is the exact shape the UI sends — no sortOrder — which is what forced
      // `nextSortOrder` to run and made every create throw. If the ORDER BY on the
      // un-aggregated column ever comes back, this REJECTS (the action throws) rather
      // than returning ok:false, so the failure is loud either way.
      const id = mkId("nosort");
      const res = await createCatalogItem({ ...base, id });

      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error(`create failed: ${res.code}`);
      expect(res.item.id).toBe(id);
      expect(res.item.hours).toBe(10);
      expect(res.item.perHour).toBe(550); // derived server-side from price/hours

      // …and it is really in the table, not just echoed back.
      const [row] = await getDb().select().from(catalogItems).where(eq(catalogItems.id, id));
      expect(row).toBeDefined();
      expect(row!.hours).toBe(10);
      expect(row!.price).toBe(5500);
      expect(row!.active).toBe(true);
    });

    it("appends to the END of its category: the assigned sortOrder is max+10", async () => {
      const db = getDb();
      const before = await db
        .select({ sortOrder: catalogItems.sortOrder })
        .from(catalogItems)
        .where(eq(catalogItems.category, "group"));
      const maxBefore = before.reduce((m, r) => Math.max(m, r.sortOrder), -10);

      const id = mkId("append");
      const res = await createCatalogItem({ ...base, id });
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.item.sortOrder).toBe(maxBefore + 10);
      const [row] = await db.select().from(catalogItems).where(eq(catalogItems.id, id));
      expect(row!.sortOrder).toBe(maxBefore + 10);
    });

    it("an explicit sortOrder is honoured (and skips the aggregate entirely)", async () => {
      const id = mkId("explicit");
      const res = await createCatalogItem({ ...base, id, sortOrder: 9999 });
      expect(res.ok).toBe(true);
      const [row] = await getDb().select().from(catalogItems).where(eq(catalogItems.id, id));
      expect(row!.sortOrder).toBe(9999);
    });

    it("rejects a duplicate id — including one that is merely ARCHIVED", async () => {
      const id = mkId("dupe");
      expect((await createCatalogItem({ ...base, id })).ok).toBe(true);
      expect(await createCatalogItem({ ...base, id })).toEqual({ ok: false, code: "DUPLICATE_ID" });

      // Archiving must NOT free the slug: reusing it would silently re-point every
      // historical charge at a new price/hours.
      expect((await archiveCatalogItem(id)).ok).toBe(true);
      expect(await createCatalogItem({ ...base, id })).toEqual({ ok: false, code: "DUPLICATE_ID" });
    });
  });

  // ─────────────────── update / archive / reorder ───────────────────

  describe("updateCatalogItem persists the edit", () => {
    it("writes new hours/price/labels and leaves id + category untouched", async () => {
      const id = mkId("upd");
      expect((await createCatalogItem({ ...base, id })).ok).toBe(true);

      const res = await updateCatalogItem({
        id,
        hours: 20,
        price: 10000,
        validity: "three_months",
        tag: "best_value",
        labelEn: "20 hours",
        labelTh: "20 ชั่วโมง",
      });
      expect(res.ok).toBe(true);

      const [row] = await getDb().select().from(catalogItems).where(eq(catalogItems.id, id));
      expect(row!.hours).toBe(20);
      expect(row!.price).toBe(10000);
      expect(row!.validity).toBe("three_months");
      expect(row!.tag).toBe("best_value");
      expect(row!.category).toBe("group"); // never in the SET clause
      expect(row!.id).toBe(id);
    });

    it("rejects a category move against the STORED category, not a client claim", async () => {
      const id = mkId("cat");
      expect((await createCatalogItem({ ...base, id })).ok).toBe(true);

      expect(
        await updateCatalogItem({
          id,
          category: "private",
          hours: 10,
          price: 5500,
          validity: "two_months",
          labelEn: "10 hours",
          labelTh: "10 ชั่วโมง",
        }),
      ).toEqual({ ok: false, code: "CATEGORY_IMMUTABLE" });

      const [row] = await getDb().select().from(catalogItems).where(eq(catalogItems.id, id));
      expect(row!.category).toBe("group"); // unchanged in the DB
    });
  });

  describe("archive is a soft retire the reads respect", () => {
    it("archive → the row SURVIVES, still resolves, and restore puts it back", async () => {
      const id = mkId("arch");
      expect((await createCatalogItem({ ...base, id })).ok).toBe(true);

      expect(await archiveCatalogItem(id)).toEqual({ ok: true, id, active: false });

      // The row must still exist and still resolve — historical charges/packages
      // reference this id forever (guardrail 3: never a hard delete).
      const [row] = await getDb().select().from(catalogItems).where(eq(catalogItems.id, id));
      expect(row).toBeDefined();
      expect(row!.active).toBe(false);
      const resolved = await getCatalogItem(id);
      expect(resolved?.hours).toBe(10);

      // The admin list still shows it (archived included).
      const list = await listCatalogForAdmin();
      expect(list.ok).toBe(true);
      if (list.ok) expect(list.items.find((i) => i.id === id)?.active).toBe(false);

      expect(await restoreCatalogItem(id)).toEqual({ ok: true, id, active: true });
      const [back] = await getDb().select().from(catalogItems).where(eq(catalogItems.id, id));
      expect(back!.active).toBe(true);
    });

    it("archiving an id that does not exist is UNKNOWN_ITEM", async () => {
      expect(await archiveCatalogItem(`${tag}-ghost`)).toEqual({ ok: false, code: "UNKNOWN_ITEM" });
    });
  });

  describe("reorderCatalog", () => {
    it("rewrites sortOrder to index × 10 for every id it matches", async () => {
      const a = mkId("ord-a");
      const b = mkId("ord-b");
      const c = mkId("ord-c");
      for (const id of [a, b, c]) {
        expect((await createCatalogItem({ ...base, id })).ok).toBe(true);
      }

      expect(await reorderCatalog({ ids: [c, a, b] })).toEqual({ ok: true });

      const db = getDb();
      const rows = await db
        .select({ id: catalogItems.id, sortOrder: catalogItems.sortOrder })
        .from(catalogItems)
        .where(inArray(catalogItems.id, [a, b, c]));
      const byId = new Map(rows.map((r) => [r.id, r.sortOrder]));
      expect(byId.get(c)).toBe(0);
      expect(byId.get(a)).toBe(10);
      expect(byId.get(b)).toBe(20);
    });
  });
});
