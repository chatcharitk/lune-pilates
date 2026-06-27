// Live concurrency proof for the "Buy credits → upload slip → admin approve"
// idempotency invariant (CLAUDE.md §5 invariant 1; Feature 3). Requires a real
// DATABASE_URL — run after `npm run db:seed` and the payment_slips migration:
//
//   npm run verify:purchase
//
// MONEY IS GRANTED ONLY ON ADMIN APPROVE (Feature 3): the customer self-confirm no
// longer credits. So the idempotency that matters now is APPROVAL idempotency: one
// checkout opens ONE charge, the customer uploads a slip, then N parallel approveSlip
// calls of that single charge must yield exactly ONE package + ONE +hours ledger row,
// with EXACTLY ONE approve reporting created:true (the racing losers recover via the
// purchase_charge_id unique-violation catch). Fixtures are tagged and cleaned up.
//
// The customer flow runs as the seeded session member (getCurrentUser → phone
// 0810000001); approveSlip runs as the mock admin. We only delete the rows this run
// created (matched by the freshly-minted chargeId), never seeded data.

import "./_load-env";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { createCheckout, confirmPayment, uploadPaymentSlip } from "@/app/actions/purchase";
import { approveSlip } from "@/app/actions/admin-payments";
import { charges, creditLedger, packages, paymentSlips } from "@/lib/db/schema";

const db = getDb();
const PARALLEL = 8; // racers approving the one charge at once
const ITEM_ID = "p10"; // 10-hour group pack — canonical catalog item

// A tiny valid 1x1 PNG as a data-URL — passes the server-side magic-byte sniff.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let failures = 0;
function check(label: string, pass: boolean, detail: string) {
  console.info(`${pass ? "✓ PASS" : "✗ FAIL"} — ${label}: ${detail}`);
  if (!pass) failures++;
}

async function scenarioApproveIdempotency() {
  // 1) One checkout → one charge intent bound server-side to the session member.
  const viewer = await getCurrentUser();
  const checkout = await createCheckout({ packageId: ITEM_ID });
  if (!checkout.ok) {
    check("checkout opens", false, `createCheckout failed: ${checkout.code}`);
    return;
  }
  const { chargeId, item } = checkout.checkout;

  console.info(
    `\n── Approve idempotency (item ${ITEM_ID}, ${item.hours}h, ${PARALLEL} parallel approves) ──`,
  );
  console.info(`   charge ${chargeId} · viewer ${viewer.id}`);

  try {
    // 2) Customer uploads a slip → charge moves to awaiting_review (no credit yet).
    const up = await uploadPaymentSlip({ chargeId, slipDataUrl: PNG_DATA_URL });
    check("slip upload succeeds", up.ok, up.ok ? "ok" : `code=${(up as { code: string }).code}`);

    const beforePkgs = await db
      .select({ id: packages.id })
      .from(packages)
      .where(eq(packages.purchaseChargeId, chargeId));
    check("no credit granted on upload", beforePkgs.length === 0, `${beforePkgs.length} package(s)`);

    // 3) Fire N parallel admin approvals of the SAME charge.
    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () => approveSlip({ chargeId })),
    );

    const okCount = results.filter((r) => r.ok).length;
    const createdCount = results.filter((r) => r.ok && r.receipt.created).length;
    const failCodes = results.filter((r) => !r.ok).map((r) => (r as { code: string }).code);

    // 4) Inspect the live rows this charge produced.
    const pkgs = await db
      .select({ id: packages.id, hoursLeft: packages.hoursLeft })
      .from(packages)
      .where(eq(packages.purchaseChargeId, chargeId));

    const purchaseLedger =
      pkgs.length === 1
        ? await db
            .select({ id: creditLedger.id, delta: creditLedger.delta })
            .from(creditLedger)
            .where(
              and(eq(creditLedger.packageId, pkgs[0]!.id), eq(creditLedger.reason, "purchase")),
            )
        : [];

    check(
      `all ${PARALLEL} approves resolve ok:true`,
      okCount === PARALLEL,
      `${okCount}/${PARALLEL} ok · fail codes: [${failCodes.join(", ")}]`,
    );
    check("exactly one package created", pkgs.length === 1, `${pkgs.length} package(s)`);
    check("exactly one approve reports created:true", createdCount === 1, `${createdCount} created:true`);
    check(
      "exactly one +hours purchase ledger row",
      purchaseLedger.length === 1,
      `${purchaseLedger.length} purchase ledger row(s)`,
    );
    check(
      `package balance equals catalog hours (${item.hours})`,
      pkgs.length === 1 && pkgs[0]!.hoursLeft === item.hours,
      `hoursLeft=${pkgs[0]?.hoursLeft}`,
    );

    const [ch] = await db.select().from(charges).where(eq(charges.chargeId, chargeId));
    check("charge flipped to paid", ch?.status === "paid", `status=${ch?.status}`);
  } finally {
    await cleanup(chargeId);
  }
}

// Negative control: a status read of an unknown charge fails closed (no credit).
async function scenarioUnknownChargeRejected() {
  console.info("\n── Unknown charge status read is rejected ──");
  const bogus = `verify_bogus_${Date.now().toString(36)}`;
  const attempt = await confirmPayment({ chargeId: bogus });
  check(
    "status read of a charge that was never opened fails closed",
    !attempt.ok && attempt.code === "UNKNOWN_CHARGE",
    attempt.ok ? `status=${attempt.status} (BUG!)` : `code=${attempt.code}`,
  );
}

/** Delete only the rows this run created for `chargeId` (slip → ledger → package → charge). */
async function cleanup(chargeId: string) {
  await db.delete(paymentSlips).where(eq(paymentSlips.chargeId, chargeId));
  const pkgs = await db
    .select({ id: packages.id })
    .from(packages)
    .where(eq(packages.purchaseChargeId, chargeId));
  for (const p of pkgs) {
    await db.delete(creditLedger).where(eq(creditLedger.packageId, p.id));
  }
  await db.delete(packages).where(eq(packages.purchaseChargeId, chargeId));
  await db.delete(charges).where(eq(charges.chargeId, chargeId));
}

async function main() {
  console.info("Running live approve concurrency verification…");
  await scenarioApproveIdempotency();
  await scenarioUnknownChargeRejected();
  console.info(`\n${failures === 0 ? "✅ ALL INVARIANTS HELD" : `❌ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
