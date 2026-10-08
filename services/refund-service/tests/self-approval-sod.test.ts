/**
 * GAP2-REFUND-APPROVAL-01 (segregation of duties / self-approval) regression.
 *
 * The two-level maker-checker refund approval (level 1 CHECKER, level 2
 * AUTHORIZER) used to enforce only level *ordering* (assertNextApprovalLevel /
 * checkExpectedLevel) and never that a DIFFERENT officer performs each level,
 * nor that the approver is not the request's creator. One officer holding
 * refund_admin/refund_approver/super_admin could therefore approve level 1 and
 * then level 2 on the same request, fully approving a monetary refund alone.
 *
 * This drives the real HTTP surface (route -> queue -> consumer -> persisted
 * state) exactly like http-routes.test.ts, varying the actor via the JWT `sub`
 * claim (hdr(sub, ...)). It asserts:
 *   - the SAME officer A cannot approve level 2 after approving level 1 (409,
 *     SELF_APPROVAL_FORBIDDEN), the request stays under_review, and NO level-2
 *     row is written;
 *   - a DISTINCT officer B can then complete level 2 and the request becomes
 *     approved;
 *   - the request's CREATOR cannot approve it at all (409).
 *
 * All three assertions FAIL on the old code (which happily recorded both
 * levels for one actor and let the creator approve).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerRequestConsumers } from "../src/modules/requests/consumer.js";
import { registerProcessingConsumers } from "../src/modules/processing/consumer.js";
import { registerReconciliationConsumers } from "../src/modules/reconciliation/consumer.js";
import { hdr, drainQueue, waitFor, TENANT_A } from "./support.js";

let app: FastifyInstance;

// Distinct, well-formed actor UUIDs. Creator C, checker A, authorizer B.
const CREATOR_C = "d4444444-0000-4000-8000-00000000000c";
const OFFICER_A = "d4444444-0000-4000-8000-00000000000a";
const OFFICER_B = "d4444444-0000-4000-8000-00000000000b";
const APPROVER_ROLES = ["refund_admin", "refund_approver", "super_admin"];

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerRequestConsumers(queue);
  registerProcessingConsumers(queue);
  registerReconciliationConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function createSubmittedRequestAs(createdBySub: string): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/v1/refund/requests",
    headers: hdr(createdBySub, TENANT_A, APPROVER_ROLES),
    payload: {
      applicantName: "SOD Test",
      applicantPhone: "9876500010",
      originalServiceType: "trade_licence",
      originalTransactionRef: `TXN-SOD-${createdBySub.slice(-4)}`,
      originalAmountMinor: "500000",
      refundAmountMinor: "500000",
      refundReason: "overpayment",
    },
  });
  expect(create.statusCode).toBe(202);
  const { id } = create.json() as { id: string };
  await waitFor(
    async () =>
      (await app.inject({ method: "GET", url: `/v1/refund/requests/${id}`, headers: hdr() })).statusCode === 200,
  );
  const submit = await app.inject({ method: "POST", url: `/v1/refund/requests/${id}/submit`, headers: hdr() });
  expect(submit.statusCode).toBe(202);
  await waitFor(async () => {
    const r = await app.inject({ method: "GET", url: `/v1/refund/requests/${id}`, headers: hdr() });
    return (r.json() as { data: { status: string } }).data.status === "under_review";
  });
  return id;
}

describe("refund processing — segregation of duties (GAP2-REFUND-APPROVAL-01)", () => {
  it("blocks the same officer from approving both levels, allows a distinct officer to complete level 2", async () => {
    // Created by C so that A/B are not the creator (that is a separate rule,
    // asserted below). A performs the level-1 CHECKER approval.
    const id = await createSubmittedRequestAs(CREATOR_C);

    const approve1 = await app.inject({
      method: "POST",
      url: "/v1/refund/processing/approve",
      headers: hdr(OFFICER_A, TENANT_A, APPROVER_ROLES),
      payload: { requestId: id, level: 1, remarks: "checker A ok" },
    });
    expect(approve1.statusCode).toBe(202);
    await drainQueue();

    const afterLevel1 = await app.inject({ method: "GET", url: `/v1/refund/requests/${id}`, headers: hdr() });
    expect((afterLevel1.json() as { data: { status: string } }).data.status).toBe("under_review");

    // A attempts level 2 — self-approval across levels. Must be refused 409.
    const approve2AsA = await app.inject({
      method: "POST",
      url: "/v1/refund/processing/approve",
      headers: hdr(OFFICER_A, TENANT_A, APPROVER_ROLES),
      payload: { requestId: id, level: 2, remarks: "same officer tries authorizer" },
    });
    expect(approve2AsA.statusCode).toBe(409);
    expect((approve2AsA.json() as { code: string }).code).toBe("SELF_APPROVAL_FORBIDDEN");
    await drainQueue();

    // Request still under_review, and the approvals list has ONLY the level-1 row.
    const stillUnderReview = await app.inject({ method: "GET", url: `/v1/refund/requests/${id}`, headers: hdr() });
    expect((stillUnderReview.json() as { data: { status: string } }).data.status).toBe("under_review");
    const approvalsAfterBlock = await app.inject({
      method: "GET",
      url: `/v1/refund/processing/approvals?requestId=${id}`,
      headers: hdr(),
    });
    const rowsAfterBlock = (approvalsAfterBlock.json() as { data: Array<{ approvalLevel: number }> }).data;
    expect(rowsAfterBlock.filter((r) => r.approvalLevel === 2)).toHaveLength(0);
    expect(rowsAfterBlock.filter((r) => r.approvalLevel === 1)).toHaveLength(1);

    // Distinct officer B completes level 2 — must succeed and fully approve.
    const approve2AsB = await app.inject({
      method: "POST",
      url: "/v1/refund/processing/approve",
      headers: hdr(OFFICER_B, TENANT_A, APPROVER_ROLES),
      payload: { requestId: id, level: 2, remarks: "authorizer B ok" },
    });
    expect(approve2AsB.statusCode).toBe(202);
    await waitFor(async () => {
      const r = await app.inject({ method: "GET", url: `/v1/refund/requests/${id}`, headers: hdr() });
      return (r.json() as { data: { status: string } }).data.status === "approved";
    });
  });

  it("blocks the request creator from approving their own request (level 1)", async () => {
    const id = await createSubmittedRequestAs(CREATOR_C);
    const approveAsCreator = await app.inject({
      method: "POST",
      url: "/v1/refund/processing/approve",
      headers: hdr(CREATOR_C, TENANT_A, APPROVER_ROLES),
      payload: { requestId: id, level: 1, remarks: "creator tries to self-approve" },
    });
    expect(approveAsCreator.statusCode).toBe(409);
    expect((approveAsCreator.json() as { code: string }).code).toBe("SELF_APPROVAL_FORBIDDEN");
  });
});
