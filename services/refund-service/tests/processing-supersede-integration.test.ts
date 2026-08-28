import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../src/shared/db.js";
import * as requestsRepo from "../src/modules/requests/repo.js";
import * as repo from "../src/modules/processing/repo.js";

// Regression test for the SEQ-1 CRITICAL bug: getMaxApprovalLevel used to
// count every historical "approved" row forever, so a return-for-correction
// (which resets the request to "requested" but left the earlier approval row
// alone) permanently defeated the maker-checker sequencing fix -- a fresh
// level-1 re-review was rejected as "out of sequence" while an unreviewed
// level-2 approval on the corrected resubmission was accepted as the
// "expected" next action. supersedeApprovals fixes this by flipping the
// prior round's "approved" rows to "superseded" the moment a request is
// returned, so this test exercises the repo layer directly (no HTTP/queue)
// against the real dev DB, wrapped in a transaction that's rolled back at
// the end so it leaves no trace.
//
// NOTE: this test sets `app.tenant_id` itself via SET LOCAL, mirroring what
// createTenantTxHook does for a real HTTP request -- there is no HTTP
// request here, so nothing else establishes that RLS context. Uses the same
// dev tenant already exercised throughout this service's live verification.
//
// SET LOCAL's value is NOT a Postgres protocol-level bind parameter position
// (unlike a normal DML WHERE clause) -- `sql\`SET LOCAL app.tenant_id =
// ${x}\`` fails with "syntax error at or near $1" because Postgres's SET
// command doesn't accept a placeholder there. sql.raw() below inlines the
// value as literal SQL text instead, which is safe ONLY because TENANT_ID is
// a hardcoded constant in this file, not external input -- never do this
// with a value that could come from a caller.
const TENANT_ID = "11111111-0000-0000-0000-000000000001";
if (!/^[0-9a-f-]{36}$/i.test(TENANT_ID)) {
  throw new Error("TENANT_ID must stay a literal, well-formed UUID -- it is inlined as raw SQL below");
}

describe("processing/repo supersedeApprovals (SEQ-1 regression)", () => {
  it("resets getMaxApprovalLevel to 0 after a return, allowing a fresh level-1 review", async () => {
    const requestId = randomUUID();
    const actorId = randomUUID();

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${TENANT_ID}'`));

        await requestsRepo.insertRequest(tx, {
          id: requestId,
          tenantId: TENANT_ID,
          requestNumber: `TEST/SEQ1/${requestId.slice(0, 8)}`,
          status: "under_review",
          applicantName: "SEQ-1 regression test",
          applicantPhone: "9000000000",
          originalServiceType: "test",
          originalTransactionRef: "SEQ1-TEST",
          originalAmountMinor: 1000n,
          refundAmountMinor: 1000n,
          refundReason: "other",
          description: null,
          documents: [],
          currency: "INR",
          createdBy: actorId,
          updatedBy: actorId,
        });

        // Round 1: level 1 approves.
        await repo.insertApproval(tx, {
          id: randomUUID(),
          tenantId: TENANT_ID,
          requestId,
          approvalLevel: 1,
          approverId: actorId,
          decision: "approved",
          remarks: null,
          decidedAt: new Date(),
          createdBy: actorId,
          updatedBy: actorId,
        });
        expect(await repo.getMaxApprovalLevelTx(tx, requestId, TENANT_ID)).toBe(1);

        // Round 1: level 2 returns it for correction.
        await repo.insertApproval(tx, {
          id: randomUUID(),
          tenantId: TENANT_ID,
          requestId,
          approvalLevel: 2,
          approverId: actorId,
          decision: "returned",
          remarks: "needs correction",
          decidedAt: new Date(),
          createdBy: actorId,
          updatedBy: actorId,
        });
        await repo.supersedeApprovals(tx, requestId, TENANT_ID, actorId);

        // THE REGRESSION: before the fix this stayed 1 forever.
        expect(await repo.getMaxApprovalLevelTx(tx, requestId, TENANT_ID)).toBe(0);

        // Round 2: level 1 approves the corrected resubmission -- must be
        // possible again, not blocked as "out of sequence".
        await repo.insertApproval(tx, {
          id: randomUUID(),
          tenantId: TENANT_ID,
          requestId,
          approvalLevel: 1,
          approverId: actorId,
          decision: "approved",
          remarks: null,
          decidedAt: new Date(),
          createdBy: actorId,
          updatedBy: actorId,
        });
        expect(await repo.getMaxApprovalLevelTx(tx, requestId, TENANT_ID)).toBe(1);

        // Round 2: level 2 completes full approval.
        await repo.insertApproval(tx, {
          id: randomUUID(),
          tenantId: TENANT_ID,
          requestId,
          approvalLevel: 2,
          approverId: actorId,
          decision: "approved",
          remarks: null,
          decidedAt: new Date(),
          createdBy: actorId,
          updatedBy: actorId,
        });
        expect(await repo.getMaxApprovalLevelTx(tx, requestId, TENANT_ID)).toBe(2);

        // Full history should show exactly these four rows, with the round-1
        // approval correctly demoted to "superseded" rather than deleted
        // (audit trail preserved) and nothing duplicated or missing. Compared
        // as a sorted multiset, not an ordered sequence: every write here
        // happens inside one transaction, and Postgres's now()/defaultNow()
        // is transaction-stable (same value for every statement in the same
        // transaction), so all four rows can legitimately tie on created_at
        // -- listByRequest's ORDER BY created_at DESC has no reliable
        // tie-breaker in that case. (In real usage each command runs in its
        // own transaction, so this ordering quirk is a test-setup artifact,
        // not a production concern -- already confirmed above anyway, since
        // every intermediate getMaxApprovalLevelTx assertion already proved
        // the actual regression fix step by step.)
        //
        // Uses the tx-scoped variant, not the plain listByRequest: that one
        // opens its own separate transaction via scopedRead, which can see
        // neither this test's still-uncommitted inserts nor the app.tenant_id
        // set on THIS transaction specifically (RLS context set via
        // SET LOCAL above lives only on this tx, not on a transaction opened
        // independently by another call).
        const history = await repo.listByRequestTx(tx, requestId, TENANT_ID);
        const decisionsByLevel = history.map((row) => `${row.approvalLevel}:${row.decision}`).sort();
        expect(decisionsByLevel).toEqual(
          ["1:approved", "1:superseded", "2:approved", "2:returned"].sort(),
        );

        // Force a rollback so this test leaves no trace in the dev DB —
        // deliberately throwing out of the transaction callback is the
        // documented way to abort a Drizzle/postgres.js transaction.
        throw new RollbackForTestCleanup();
      }),
    ).rejects.toThrow(RollbackForTestCleanup);
  });
});

class RollbackForTestCleanup extends Error {}
