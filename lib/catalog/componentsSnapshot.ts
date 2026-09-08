// Freeze/thaw for the bundle components a charge was bought against
// (`charges.components_json`).
//
// WHY A SNAPSHOT. Components are owner-editable at runtime, and a PromptPay charge
// can sit in `awaiting_review` for days while the front desk checks the slip. If
// crediting re-resolved the components live at approval time, an edit made in that
// window would retroactively change what an already-paid purchase grants — the same
// hazard the charge's hours/validity snapshot columns exist to prevent
// (lib/catalog/chargeTerms.ts), but for the SHAPE of the grant rather than its size.
//
// Encoding is deliberately dumb: JSON of exactly the fields crediting needs, with a
// version tag so a future shape change can be detected rather than silently
// misread. Parsing is total — any malformed, unknown-version or structurally
// invalid payload returns null, and the caller falls back to live resolution.

import type { PackageCategory } from "@/lib/domain/types";
import type { ValidityUnit } from "./packages";
import { validateComponentSet, type CatalogComponent } from "./components";

const SNAPSHOT_VERSION = 1;

interface SnapshotEnvelope {
  v: number;
  components: unknown;
}

/** Serialize the components a charge is being opened against. */
export function serializeComponentsSnapshot(components: CatalogComponent[]): string {
  return JSON.stringify({
    v: SNAPSHOT_VERSION,
    components: components.map((c) => ({
      componentKey: c.componentKey,
      category: c.category,
      hours: c.hours,
      validityAmount: c.validity.amount,
      validityUnit: c.validity.unit,
      anchorComponentKey: c.anchorComponentKey,
      sortOrder: c.sortOrder,
      labelEn: c.label.en,
      labelTh: c.label.th,
    })),
  });
}

const CATEGORIES: readonly string[] = ["group", "private", "rental"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseOne(raw: unknown): CatalogComponent | null {
  if (!isRecord(raw)) return null;
  const {
    componentKey,
    category,
    hours,
    validityAmount,
    validityUnit,
    anchorComponentKey,
    sortOrder,
    labelEn,
    labelTh,
  } = raw;

  if (typeof componentKey !== "string" || componentKey === "") return null;
  if (typeof category !== "string" || !CATEGORIES.includes(category)) return null;
  if (!Number.isSafeInteger(hours) || (hours as number) <= 0) return null;
  if (!Number.isSafeInteger(validityAmount) || (validityAmount as number) <= 0) return null;
  if (validityUnit !== "day" && validityUnit !== "month") return null;
  if (anchorComponentKey !== null && typeof anchorComponentKey !== "string") return null;
  if (typeof labelEn !== "string" || typeof labelTh !== "string") return null;

  return {
    componentKey,
    category: category as PackageCategory,
    hours: hours as number,
    validity: { amount: validityAmount as number, unit: validityUnit as ValidityUnit },
    anchorComponentKey: (anchorComponentKey as string | null) ?? null,
    sortOrder: Number.isSafeInteger(sortOrder) ? (sortOrder as number) : 0,
    label: { en: labelEn, th: labelTh },
  };
}

/**
 * Thaw a stored snapshot, or null when there is none / it cannot be trusted.
 *
 * Returning null on ANY doubt is deliberate: the caller then resolves the item's
 * components live, which grants the customer the balances the item currently
 * describes. That is a recoverable outcome; crediting a half-parsed bundle would
 * not be.
 */
export function parseComponentsSnapshot(json: string | null): CatalogComponent[] | null {
  if (!json) return null;

  let envelope: SnapshotEnvelope;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) return null;
    envelope = parsed as unknown as SnapshotEnvelope;
  } catch {
    return null;
  }

  if (envelope.v !== SNAPSHOT_VERSION) return null;
  if (!Array.isArray(envelope.components) || envelope.components.length === 0) return null;

  const out: CatalogComponent[] = [];
  for (const raw of envelope.components) {
    const one = parseOne(raw);
    if (!one) return null; // all-or-nothing: never credit a partial bundle
    out.push(one);
  }

  // A snapshot that no longer forms a coherent set (an anchor naming a component
  // that isn't in it, a cycle) would leave a balance permanently dormant. Fall back
  // to live resolution rather than grant credit the customer could never spend.
  if (validateComponentSet(out) !== null) return null;

  return out;
}
