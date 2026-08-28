import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../src/shared/db.js";
import * as requestsRepo from "../src/modules/requests/repo.js";

// Regression test for FIN-6: a level-1 (checker) approve had NO check of the
// request's own status at all -- not a race, a flatly missing guard.
// checkExpectedLevel only ever looked at refund_approvals (is this the next
// expected LEVEL); the only place refund_requests.status was checked was
// inside `if (isFullyApproved(level))`, which is false for every level-1
// approval in this 2-level scheme. So insertApproval ran unconditionally at
// level 1 regardless of the request's actual status.
//
// IMPORTANT nuance, confirmed by live testing before writing this test: the
// fix (an unconditional status check via assertActionable, using
// requestsRepo.findByIdTx) does NOT and should NOT prevent "approve level 1,
// then SEPARATELY/LATER withdraw" -- requests/domain.ts's own
// VALID_TRANSITIONS models under_review -> withdrawn as valid regardless of
// partial approval progress (a citizen can withdraw before FULL approval),
// and at the moment a standalone level-1 approve runs, the request
// genuinely IS under_review, so it must succeed and the resulting approval
// record is an honest, non-contradictory historical fact. What the fix
// actually closes is the RACE variant: withdraw commits first, and a STALE
// approve command (published earlier, when the route-level check still saw
// "under_review") would previously still insert an approval for a request
// that, by the time this consumer transaction actually runs, is already
// withdrawn -- an approval "created after" the request was already dead.
// This test isolates exactly that precondition check directly against the
// real dev DB rather than trying to win a real concurrency race.
const TENANT_ID = "11111111-0000-0000-0000-000000000001";
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(TENANT_ID)) {
  throw new Error("TENANT_ID must stay a literal, well-formed UUID -- it is inlined as raw SQL below");
}

describe("requests/repo findByIdTx status check (FIN-6 regression)", () => {
  it("reports a withdrawn request's real status from inside a transaction, not the stale under_review it had when a racing command was published", async () => {
    const id = randomUUID();
    const actorId = randomUUID();

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_ID}'`));

        await requestsRepo.insertRequest(tx, {
          id, tenantId: TENANT_ID, requestNumber: `TEST/FIN6/${id.slice(0, 8)}`,
          status: "under_review",
          applicantName: "FIN-6 test", applicantPhone: "9000000000",
          originalServiceType: "test", originalTransactionRef: "FIN6-TEST",
          originalAmountMinor: 100n, refundAmountMinor: 100n, refundReason: "other",
          description: null, documents: [], currency: "INR",
          createdBy: actorId, updatedBy: actorId,
        });

        // Simulates withdraw winning a race: it commits (in spirit -- same
        // transaction here for test simplicity) before the stale approve
        // command's consumer gets to check.
        await requestsRepo.updateStatus(tx, id, TENANT_ID, "withdrawn", actorId, ["under_review"]);

        // THE REGRESSION CHECK: this is exactly what processing/consumer.ts's
        // assertActionable now calls before allowing insertApproval to run,
        // for every level, not just fully-approving ones. Before the fix,
        // nothing called this for a level-1 approve at all.
        const request = await requestsRepo.findByIdTx(tx, id, TENANT_ID);
        expect(request?.status).toBe("withdrawn");
        expect(request?.status).not.toBe("under_review");

        throw new RollbackForTestCleanup();
      }),
    ).rejects.toThrow(RollbackForTestCleanup);
  });

  it("still reports under_review for a request nothing has touched yet", async () => {
    const id = randomUUID();
    const actorId = randomUUID();

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_ID}'`));
        await requestsRepo.insertRequest(tx, {
          id, tenantId: TENANT_ID, requestNumber: `TEST/FIN6/${id.slice(0, 8)}`,
          status: "under_review",
          applicantName: "FIN-6 test (control)", applicantPhone: "9000000000",
          originalServiceType: "test", originalTransactionRef: "FIN6-TEST-2",
          originalAmountMinor: 100n, refundAmountMinor: 100n, refundReason: "other",
          description: null, documents: [], currency: "INR",
          createdBy: actorId, updatedBy: actorId,
        });

        const request = await requestsRepo.findByIdTx(tx, id, TENANT_ID);
        expect(request?.status).toBe("under_review");

        throw new RollbackForTestCleanup();
      }),
    ).rejects.toThrow(RollbackForTestCleanup);
  });
});

class RollbackForTestCleanup extends Error {}
