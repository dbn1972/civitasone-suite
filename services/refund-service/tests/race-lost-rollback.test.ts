import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, RaceLost, transactionOrRaceLost, type ScopedTx } from "../src/shared/db.js";
import * as requestsRepo from "../src/modules/requests/repo.js";

// Regression test for RACE-3: several processing/consumer.ts and
// reconciliation/consumer.ts handlers do an unconditional domain write
// (insertApproval / insertDisbursement) BEFORE a later compare-and-swap
// guard (updateStatus) that can fail if a different action won a
// cross-topic race in between. The bug: a plain `return false` in that
// situation does NOT roll back the earlier write, because
// Drizzle/postgres-js commits a transaction whenever the callback's promise
// RESOLVES, regardless of the resolved value -- only a REJECTED promise
// (a thrown error) triggers a rollback. Live-reproduced concretely: racing
// processing/consumer.ts's returnRequest against requests/consumer.ts's
// withdrawRequest let withdraw legitimately win (final status "withdrawn")
// while return's insertApproval + supersedeApprovals had ALREADY committed
// before its own status guard caught the conflict -- a phantom "returned"
// decision and an incorrectly-superseded real approval, permanently on
// record, for a request that was never actually returned.
//
// This test isolates the actual mechanism (shared/db.ts's RaceLost +
// transactionOrRaceLost) directly against the real dev DB: does throwing
// RaceLost after a write really roll that write back, and does
// transactionOrRaceLost convert that into a plain `false` return instead of
// an unhandled rejection (so the queue doesn't treat a correctly-detected
// lost race as a retryable processing failure)?
//
// NOTE: verification queries below go through a raw tx.execute(...) SELECT
// inside a transaction THIS test controls (with its own SET LOCAL
// app.tenant_id), not through requestsRepo.findById -- that function opens
// its OWN separate transaction internally (via scopedRead), which would not
// inherit this test's tenant context and would report "not found" (blocked
// by RLS) regardless of whether the row actually exists, making the
// assertion meaningless either way.
const TENANT_ID = "11111111-0000-0000-0000-000000000001";
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(TENANT_ID)) {
  throw new Error("TENANT_ID must stay a literal, well-formed UUID -- it is inlined as raw SQL below");
}

async function countRequestRows(tx: ScopedTx, id: string): Promise<number> {
  const result = await tx.execute(sql`SELECT id FROM refund.refund_requests WHERE id = ${id}`);
  // postgres.js returns SELECT results as a directly array-like RowList.
  return Array.isArray(result) ? result.length : (result as unknown as { length?: number }).length ?? 0;
}

describe("transactionOrRaceLost (RACE-3 regression)", () => {
  it("rolls back an earlier write in the same transaction when RaceLost is thrown afterward", async () => {
    const id = randomUUID();
    const actorId = randomUUID();

    const result = await transactionOrRaceLost(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_ID}'`));

      // THE UNCONDITIONAL WRITE (stands in for insertApproval / insertDisbursement).
      await requestsRepo.insertRequest(tx, {
        id, tenantId: TENANT_ID, requestNumber: `TEST/RACE3/${id.slice(0, 8)}`,
        status: "requested",
        applicantName: "RACE-3 test", applicantPhone: "9000000000",
        originalServiceType: "test", originalTransactionRef: "RACE3-TEST",
        originalAmountMinor: 100n, refundAmountMinor: 100n, refundReason: "other",
        description: null, documents: [], currency: "INR",
        createdBy: actorId, updatedBy: actorId,
      });

      // THE LATER GUARD, simulated as failing (a lost race).
      throw new RaceLost();
    });

    // transactionOrRaceLost must convert the throw into `false`, not an
    // unhandled rejection.
    expect(result).toBe(false);

    // THE REGRESSION CHECK: was the insert rolled back? A fresh transaction
    // (the one above has definitely committed-or-rolled-back by now) with
    // its own correctly-set tenant context.
    const count = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_ID}'`));
      return countRequestRows(tx, id);
    });
    expect(count).toBe(0);
  });

  it("still commits normally when the callback resolves without throwing", async () => {
    const id = randomUUID();
    const actorId = randomUUID();

    const result = await transactionOrRaceLost(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_ID}'`));
      await requestsRepo.insertRequest(tx, {
        id, tenantId: TENANT_ID, requestNumber: `TEST/RACE3/${id.slice(0, 8)}`,
        status: "requested",
        applicantName: "RACE-3 test (committed)", applicantPhone: "9000000000",
        originalServiceType: "test", originalTransactionRef: "RACE3-TEST-2",
        originalAmountMinor: 100n, refundAmountMinor: 100n, refundReason: "other",
        description: null, documents: [], currency: "INR",
        createdBy: actorId, updatedBy: actorId,
      });
      return true;
    });

    expect(result).toBe(true);

    const count = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_ID}'`));
      return countRequestRows(tx, id);
    });
    expect(count).toBe(1);

    // Cleanup: this one genuinely committed, so it needs an explicit delete
    // rather than a rollback.
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_ID}'`));
      await tx.execute(sql`DELETE FROM refund.refund_requests WHERE id = ${id}`);
    });
  });

  it("does not swallow a genuine (non-RaceLost) error", async () => {
    class SomeOtherError extends Error {}
    await expect(
      transactionOrRaceLost(async () => {
        throw new SomeOtherError("not a lost race, a real failure");
      }),
    ).rejects.toThrow(SomeOtherError);
  });
});
