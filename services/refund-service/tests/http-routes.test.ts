/**
 * HTTP route tests (app.inject()-based) for refund-service's main write
 * routes.
 *
 * The 7 pre-existing test files (32 tests) exercise domain.ts logic and
 * repo.ts/consumer.ts functions directly — never through the Fastify route
 * layer. That leaves everything routes.ts itself does — Zod body/query
 * parsing (MINOR_AMOUNT's regex, uuid params), role checks (requireRole),
 * and the route-level guards that live ONLY in routes.ts and are never
 * called from any repo/consumer/domain function (FIN-1's amount-vs-original
 * bound at creation, FIN-2's assertNextApprovalLevel maker-checker sequence
 * gate, FIN-5's ALREADY_RECONCILED re-check) — entirely unexercised. A repo
 * function called directly in a test never sees a malformed request body;
 * a route does.
 *
 * This file drives the real HTTP surface with app.inject() (no network
 * socket, but the full Fastify request/response pipeline: auth plugin,
 * tenant-context hooks, Zod validation, route handlers, error mapping) and
 * registers the real consumers exactly like src/worker.ts, draining the
 * in-memory queue between steps — proving the whole route -> queue ->
 * consumer -> persisted-state path actually works end to end, not just that
 * the consumer function does the right thing when called with a
 * hand-built payload.
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

const bankDetails = {
  accountNumber: "123456789012",
  ifscCode: "SBIN0001234",
  accountHolderName: "Test Applicant",
};

async function createSubmittedRequest(overrides: Partial<{ originalAmountMinor: string; refundAmountMinor: string }> = {}) {
  const create = await app.inject({
    method: "POST",
    url: "/v1/refund/requests",
    headers: hdr(),
    payload: {
      applicantName: "HTTP Route Test",
      applicantPhone: "9876500001",
      originalServiceType: "trade_licence",
      originalTransactionRef: "TXN-HTTP-1",
      originalAmountMinor: overrides.originalAmountMinor ?? "500000",
      refundAmountMinor: overrides.refundAmountMinor ?? "500000",
      refundReason: "overpayment",
    },
  });
  expect(create.statusCode).toBe(202);
  const { id } = create.json() as { id: string };
  await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/refund/requests/${id}`, headers: hdr() })).statusCode === 200);

  const submit = await app.inject({ method: "POST", url: `/v1/refund/requests/${id}/submit`, headers: hdr() });
  expect(submit.statusCode).toBe(202);
  await waitFor(async () => {
    const r = await app.inject({ method: "GET", url: `/v1/refund/requests/${id}`, headers: hdr() });
    return (r.json() as { data: { status: string } }).data.status === "under_review";
  });
  return id;
}

describe("refund-service HTTP routes — full request → approval → disbursement → reconciliation lifecycle", () => {
  it("drives the complete happy path through the real HTTP layer and asserts persisted state at every stage", async () => {
    const id = await createSubmittedRequest();

    // Two-level maker-checker approval, in sequence, over real HTTP.
    const approve1 = await app.inject({
      method: "POST",
      url: "/v1/refund/processing/approve",
      headers: hdr(),
      payload: { requestId: id, level: 1, remarks: "checker ok" },
    });
    expect(approve1.statusCode).toBe(202);
    await drainQueue();

    // After level 1 only, the request must still be under_review — not
    // fully approved (isFullyApproved only trips at level 2).
    const afterLevel1 = await app.inject({ method: "GET", url: `/v1/refund/requests/${id}`, headers: hdr() });
    expect((afterLevel1.json() as { data: { status: string } }).data.status).toBe("under_review");

    const approve2 = await app.inject({
      method: "POST",
      url: "/v1/refund/processing/approve",
      headers: hdr(),
      payload: { requestId: id, level: 2, remarks: "authorizer ok" },
    });
    expect(approve2.statusCode).toBe(202);
    await waitFor(async () => {
      const r = await app.inject({ method: "GET", url: `/v1/refund/requests/${id}`, headers: hdr() });
      return (r.json() as { data: { status: string } }).data.status === "approved";
    });

    const approvals = await app.inject({ method: "GET", url: `/v1/refund/processing/approvals?requestId=${id}`, headers: hdr() });
    expect(approvals.statusCode).toBe(200);
    expect((approvals.json() as { meta: { total: number } }).meta.total).toBe(2);

    // Disbursement: initiate -> complete -> reconcile, over real HTTP.
    const initiate = await app.inject({
      method: "POST",
      url: "/v1/refund/disbursements",
      headers: hdr(),
      payload: { requestId: id, bankAccountDetails: bankDetails, disbursedAmountMinor: "500000" },
    });
    expect(initiate.statusCode).toBe(202);
    const { id: disbId } = initiate.json() as { id: string };
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/refund/disbursements/${disbId}`, headers: hdr() })).statusCode === 200);

    const initiated = await app.inject({ method: "GET", url: `/v1/refund/disbursements/${disbId}`, headers: hdr() });
    expect((initiated.json() as { data: { status: string } }).data.status).toBe("initiated");
    const processingReq = await app.inject({ method: "GET", url: `/v1/refund/requests/${id}`, headers: hdr() });
    expect((processingReq.json() as { data: { status: string } }).data.status).toBe("processing");

    const complete = await app.inject({
      method: "POST",
      url: `/v1/refund/disbursements/${disbId}/complete`,
      headers: hdr(),
      payload: { disbursementRef: "UTR-HTTP-TEST-1" },
    });
    expect(complete.statusCode).toBe(202);
    await waitFor(async () => {
      const r = await app.inject({ method: "GET", url: `/v1/refund/disbursements/${disbId}`, headers: hdr() });
      return (r.json() as { data: { status: string } }).data.status === "completed";
    });
    const refundedReq = await app.inject({ method: "GET", url: `/v1/refund/requests/${id}`, headers: hdr() });
    expect((refundedReq.json() as { data: { status: string } }).data.status).toBe("refunded");

    const reconcile = await app.inject({ method: "POST", url: `/v1/refund/disbursements/${disbId}/reconcile`, headers: hdr() });
    expect(reconcile.statusCode).toBe(202);
    await waitFor(async () => {
      const r = await app.inject({ method: "GET", url: `/v1/refund/disbursements/${disbId}`, headers: hdr() });
      return (r.json() as { data: { reconciledAt: string | null } }).data.reconciledAt !== null;
    });

    // FIN-5, route-level: a second reconcile on the same disbursement must
    // be refused with 409 — this precondition lives only in
    // reconciliation/routes.ts (existing.reconciledAt), not in repo.reconcile
    // or the consumer, so only an HTTP-level test can exercise it.
    const secondReconcile = await app.inject({ method: "POST", url: `/v1/refund/disbursements/${disbId}/reconcile`, headers: hdr() });
    expect(secondReconcile.statusCode).toBe(409);
    expect((secondReconcile.json() as { code: string }).code).toBe("ALREADY_RECONCILED");
  });

  it("FIN-1, route-level: refundAmountMinor greater than originalAmountMinor is refused with 422 at creation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/refund/requests",
      headers: hdr(),
      payload: {
        applicantName: "Over-refund Test",
        applicantPhone: "9876500002",
        originalServiceType: "trade_licence",
        originalTransactionRef: "TXN-HTTP-OVER",
        originalAmountMinor: "1000",
        refundAmountMinor: "2000",
        refundReason: "overpayment",
      },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe("REFUND_AMOUNT_INVALID");
  });

  it("MINOR_AMOUNT, route-level: a malformed amount string (leading zero) fails Zod validation with 400, never reaching the consumer", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/refund/requests",
      headers: hdr(),
      payload: {
        applicantName: "Malformed Amount Test",
        applicantPhone: "9876500003",
        originalServiceType: "trade_licence",
        originalTransactionRef: "TXN-HTTP-BAD-AMT",
        originalAmountMinor: "0100",
        refundAmountMinor: "0100",
        refundReason: "overpayment",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("FIN-2, route-level: an approval submitted out of maker-checker sequence (level 2 before level 1) is refused with 422", async () => {
    const id = await createSubmittedRequest();
    const res = await app.inject({
      method: "POST",
      url: "/v1/refund/processing/approve",
      headers: hdr(),
      payload: { requestId: id, level: 2, remarks: "skipping level 1" },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe("APPROVAL_SEQUENCE_INVALID");
  });

  it("requireRole: a caller without any refund role is refused with 403, and the command is never published", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/refund/requests",
      headers: hdr(undefined, TENANT_A, ["some_unrelated_role"]),
      payload: {
        applicantName: "No Role Test",
        applicantPhone: "9876500004",
        originalServiceType: "trade_licence",
        originalTransactionRef: "TXN-HTTP-NOROLE",
        originalAmountMinor: "1000",
        refundAmountMinor: "1000",
        refundReason: "overpayment",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET on a nonexistent request id returns 404, not a silent empty success", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/refund/requests/00000000-0000-4000-8000-000000000000", headers: hdr() });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { code: string }).code).toBe("REQUEST_NOT_FOUND");
  });
});
