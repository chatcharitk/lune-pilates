// Seed / re-sync the EDITABLE purchasable package catalog (`catalog_items`) from
// the canonical SEED_CATALOG constant in lib/catalog/packages.ts.
//
// Mirrors scripts/seed.ts conventions: requires DATABASE_URL, idempotent, safe to
// re-run.
//
//   psql "$DATABASE_URL" -f drizzle/0001_catalog_items.sql   # create the table
//   npx tsx scripts/seed-catalog.ts                          # populate it
//
// IDEMPOTENCY + the owner's edits: this UPSERTS by id. Re-running RESETS every
// seeded item back to the constant's price/hours/labels — so do NOT re-run it on a
// live studio after the owner has edited prices, or their edits are overwritten.
// It is a first-run/bootstrap tool. Items the owner ADDED are never touched (they
// are not in the constant), and `active` is never reset, so an archived seed item
// stays archived across a re-run.

import "./_load-env";
import { getDb } from "@/lib/db/client";
import { catalogItems } from "@/lib/db/schema";
import { SEED_CATALOG, legacyValidityText } from "@/lib/catalog/packages";

async function main() {
  const db = getDb();

  for (const item of SEED_CATALOG) {
    const validityText = legacyValidityText(item.validity);
    await db
      .insert(catalogItems)
      .values({
        id: item.id,
        category: item.category,
        hours: item.hours,
        price: item.price,
        // Structured validity is the real source; the legacy text satisfies NOT NULL.
        validity: validityText,
        validityAmount: item.validity.amount,
        validityUnit: item.validity.unit,
        tag: item.tag ?? null,
        labelEn: item.label.en,
        labelTh: item.label.th,
        active: true,
        sortOrder: item.sortOrder,
      })
      .onConflictDoUpdate({
        target: catalogItems.id,
        set: {
          // `id` and `category` are deliberately NOT in the SET clause: they are
          // immutable by the same rule the admin action enforces (the category
          // decides which credit bucket a booking debits — moving it would corrupt
          // already-sold balances). `active` is also left alone so re-seeding never
          // silently un-archives an item the owner retired.
          hours: item.hours,
          price: item.price,
          validity: validityText,
          validityAmount: item.validity.amount,
          validityUnit: item.validity.unit,
          tag: item.tag ?? null,
          labelEn: item.label.en,
          labelTh: item.label.th,
          sortOrder: item.sortOrder,
        },
      });
  }

  console.log(`Catalog seeded: ${SEED_CATALOG.length} items upserted into catalog_items.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
