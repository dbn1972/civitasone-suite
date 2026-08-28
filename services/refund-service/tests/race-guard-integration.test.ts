import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, type ScopedTx } from "../src/shared/db.js";
import * as requestsRepo from "../src/modules/requests/repo.js";
import * as reconciliationRepo from "../src/modules/reconciliation/repo.js";

// Regression test for RACE-1: requests/repo.ts's updateStatus and
// reconciliation/repo.ts's updateStatus/markFailed used to UPDATE ... WHERE
// id=? AND tenant_id=? with no precondition on the row's current status.
// Because different action types on the same row publish to different queue
// topics with no ordering between their poll loops (see
// services/queue-service/src/bus.ts's SqsQueue.start, one independent
// pollTopic() per topic), two different actions submitted a normal HTTP
// round-trip apart -- not nanoseconds apart -- could both pass their own
// route-level pre-check and then have the SECOND one's consumer silently
// overwrite the first one's effect (e.g. an approve undoing a reject; a
// complete-then-fail flipping an already-paid disbursement back to "failed",
// which the double-disbursement guard's own status<>'failed' exclusion then
// treats as retry-eligible -- a real double payout).
//
// This test exercises the compare-and-swap guard itself directly against
// the real dev DB: does the UPDATE actually refuse to apply when the row's
// current status isn't in the allowed set, and actually apply when it is?
// That's the entire fix, and it's the exact thing that regresses silently if
// a future edit ever adds a default value for `allowedFromStatuses` or
// forgets to pass it. Uses one transaction per assertion group, rolled back
// via a thrown sentinel so nothing is left in the dev DB.
const TENANT_ID = "11111111-0000-0000-0000-000000000001";
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(TENANT_ID)) {
  throw new Error("TENANT_ID must stay a literal, well-formed UUID -- it is inlined as raw SQL below");
}

class RollbackForTestCleanup extends Error {}

async function withTenantTx<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<void> {
  await expect(
    db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_ID}'`));
      await fn(tx);
      throw new RollbackForTestCleanup();
    }),
  ).rejects.toThrow(RollbackForTestCleanup);
}

describe("requests/repo updateStatus compare-and-swap (RACE-1 regression)", () => {
  it("refuses to update when the current status is not in allowedFromStatuses", async () => {
    await withTenantTx(async (tx) => {
      const id = randomUUID();
      const actorId = randomUUID();
      await requestsRepo.insertRequest(tx, {
        id, tenantId: TENANT_ID, requestNumber: `TEST/RACE1/${id.slice(0, 8)}`,
        status: "rejected", // already terminal
        applicantName: "RACE-1 test", applicantPhone: "9000000000",
        originalServiceType: "test", originalTransactionRef: "RACE1-TEST",
        originalAmountMinor: 100n, refundAmountMinor: 100n, refundReason: "other",
        description: null, documents: [], currency: "INR",
        createdBy: actorId, updatedBy: actorId,
      });

      // THE REGRESSION: before the fix, this unconditionally succeeded
      // regardless of current status, which is exactly what let a racing
      // approve silently overwrite a just-recorded rejection.
      const resurrected = await requestsRepo.updateStatus(tx, id, TENANT_ID, "approved", actorId, ["under_review"]);
      expect(resurrected).toBe(false);
    });
  });

  it("still applies normally when the current status IS in allowedFromStatuses", async () => {
    await withTenantTx(async (tx) => {
      const id = randomUUID();
      const actorId = randomUUID();
      await requestsRepo.insertRequest(tx, {
        id, tenantId: TENANT_ID, requestNumber: `TEST/RACE1/${id.slice(0, 8)}`,
        status: "under_review",
        applicantName: "RACE-1 test", applicantPhone: "9000000000",
        originalServiceType: "test", originalTransactionRef: "RACE1-TEST-2",
        originalAmountMinor: 100n, refundAmountMinor: 100n, refundReason: "other",
        description: null, documents: [], currency: "INR",
        createdBy: actorId, updatedBy: actorId,
      });

      const ok = await requestsRepo.updateStatus(tx, id, TENANT_ID, "approved", actorId, ["under_review"]);
      expect(ok).toBe(true);
    });
  });
});

describe("reconciliation/repo updateStatus/markFailed compare-and-swap (RACE-1 regression -- the severe trace)", () => {
  it("refuses to mark an already-completed disbursement as failed", async () => {
    await withTenantTx(async (tx) => {
      const id = randomUUID();
      const actorId = randomUUID();
      await tx.execute(sql`
        INSERT INTO refund.refund_disbursements
          (id, tenant_id, request_id, bank_account_details, disbursed_amount_minor, status, currency, created_by, updated_by)
        VALUES (${id}, ${TENANT_ID}, ${randomUUID()}, '{"accountNumber":"1","ifscCode":"X","accountHolderName":"Y"}'::jsonb, 100, 'completed', 'INR', ${actorId}, ${actorId})
      `);

      // THE SEVERE REGRESSION: before the fix, this unconditionally set
      // status="failed" even though the disbursement was already
      // "completed" (real money already sent) -- and since the
      // double-disbursement guard excludes only status='failed' from
      // counting as active, that flip reopened the request for a real
      // second disbursement. A double payout on a government refund system.
      const flippedToFailed = await reconciliationRepo.markFailed(tx, id, TENANT_ID, "should not apply", actorId, ["initiated", "processing"]);
      expect(flippedToFailed).toBe(false);
    });
  });

  it("refuses to complete an already-failed disbursement", async () => {
    await withTenantTx(async (tx) => {
      const id = randomUUID();
      const actorId = randomUUID();
      await tx.execute(sql`
        INSERT INTO refund.refund_disbursements
          (id, tenant_id, request_id, bank_account_details, disbursed_amount_minor, status, currency, created_by, updated_by)
        VALUES (${id}, ${TENANT_ID}, ${randomUUID()}, '{"accountNumber":"1","ifscCode":"X","accountHolderName":"Y"}'::jsonb, 100, 'failed', 'INR', ${actorId}, ${actorId})
      `);

      const flippedToCompleted = await reconciliationRepo.updateStatus(tx, id, TENANT_ID, "completed", actorId, ["initiated", "processing"]);
      expect(flippedToCompleted).toBe(false);
    });
  });

  it("still completes normally from initiated", async () => {
    await withTenantTx(async (tx) => {
      const id = randomUUID();
      const actorId = randomUUID();
      await tx.execute(sql`
        INSERT INTO refund.refund_disbursements
          (id, tenant_id, request_id, bank_account_details, disbursed_amount_minor, status, currency, created_by, updated_by)
        VALUES (${id}, ${TENANT_ID}, ${randomUUID()}, '{"accountNumber":"1","ifscCode":"X","accountHolderName":"Y"}'::jsonb, 100, 'initiated', 'INR', ${actorId}, ${actorId})
      `);

      const ok = await reconciliationRepo.updateStatus(tx, id, TENANT_ID, "completed", actorId, ["initiated", "processing"]);
      expect(ok).toBe(true);
    });
  });
});
