/**
 * F3-01 maker ≠ checker for quotation approvals.
 *
 * The decide route must return 403 SELF_APPROVAL_FORBIDDEN when the actor granting the
 * approval is the same person who requested it OR who created the quotation. A different
 * actor may approve, and anyone (including the requester) may still reject their own
 * request. Writes are CQRS (202 + drain), state asserted through the read path.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { randomUUID } from "node:crypto";
import { COMMANDS } from "../src/topics.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-0000000000f3";
const MAKER = "cccccccc-3333-4000-8000-0000000000f1";
const CHECKER = "cccccccc-3333-4000-8000-0000000000f2";

function tokenFor(sub: string, roles: string[]) {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s-f301" }, SECRET)}`, "x-tenant-id": TENANT };
}
const makerHeaders = (roles = ["crm_admin"]) => tokenFor(MAKER, roles);
const checkerHeaders = (roles = ["crm_admin"]) => tokenFor(CHECKER, roles);

function scoped<T>(fn: (tx: Parameters<Parameters<typeof sqlClient.begin>[0]>[0]) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup() {
  await scoped(async (tx) => {
    await tx`DELETE FROM crm.quotation_line_items WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.quotation_approvals WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.approval_thresholds WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.quotations WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM crm.products WHERE tenant_id = ${TENANT}`;
    return 0;
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

/**
 * Build a 30%-discounted quotation created by MAKER with a 10% threshold, then raise an
 * approval request (also by MAKER). Returns { quotationId, approvalId }.
 */
async function makerQuoteWithPendingApproval(app: Awaited<ReturnType<typeof buildApp>>, suffix: string) {
  await app.inject({ method: "PUT", url: "/v1/crm/quotation-approvals/thresholds", headers: makerHeaders(), payload: { approvalType: "discount", maxDiscountBps: 1000 } });
  await drainQueue();

  await app.inject({ method: "POST", url: "/v1/crm/products", headers: makerHeaders(), payload: { code: `F3-${suffix}`, name: suffix, priceMinor: "1000000", enabled: true } });
  await drainQueue();
  const prow = await scoped((tx) => tx<Array<{ id: string }>>`SELECT id FROM crm.products WHERE code = ${`F3-${suffix}`} AND tenant_id = ${TENANT}`);
  const productId = prow[0]!.id;

  const quote = await app.inject({
    method: "POST", url: "/v1/crm/quotations", headers: makerHeaders(),
    payload: { quoteRef: `Q-F3-${suffix}`, templateRef: "T1", currency: "INR", lineItems: [{ productId, description: "seat", quantity: 1, unitPriceMinor: "700000" }] },
  });
  const quotationId = quote.json().id;
  await drainQueue();

  await app.inject({ method: "POST", url: `/v1/crm/quotations/${quotationId}/approvals`, headers: makerHeaders(["crm_user"]), payload: { approvalType: "discount", discountBps: 3000, reason: "Strategic account discount" } });
  await drainQueue();

  const approvals = await app.inject({ method: "GET", url: `/v1/crm/quotations/${quotationId}/approvals`, headers: makerHeaders() });
  const approvalId = approvals.json().data[0].id;
  return { quotationId, approvalId };
}

describe("F3-01 quotation self-approval guard", () => {
  it("forbids the requester/creator from approving their own request → 403 SELF_APPROVAL_FORBIDDEN", async () => {
    const app = await buildApp();
    const { quotationId, approvalId } = await makerQuoteWithPendingApproval(app, "SELF");

    const selfApprove = await app.inject({ method: "POST", url: `/v1/crm/quotation-approvals/${approvalId}/decide`, headers: makerHeaders(), payload: { decision: "approve" } });
    expect(selfApprove.statusCode).toBe(403);
    expect(selfApprove.json().code).toBe("SELF_APPROVAL_FORBIDDEN");

    // The approval stays pending, so the send gate is still closed.
    const stillBlocked = await app.inject({ method: "POST", url: `/v1/crm/quotations/${quotationId}/send`, headers: makerHeaders() });
    await app.close();
    expect(stillBlocked.statusCode).toBe(422);
    expect(stillBlocked.json().code).toBe("APPROVAL_REQUIRED");
  });

  it("allows a different actor to approve, then the send succeeds → 202", async () => {
    const app = await buildApp();
    const { quotationId, approvalId } = await makerQuoteWithPendingApproval(app, "OTHER");

    const otherApprove = await app.inject({ method: "POST", url: `/v1/crm/quotation-approvals/${approvalId}/decide`, headers: checkerHeaders(), payload: { decision: "approve" } });
    expect(otherApprove.statusCode).toBe(202);
    await drainQueue();

    const sent = await app.inject({ method: "POST", url: `/v1/crm/quotations/${quotationId}/send`, headers: makerHeaders() });
    await app.close();
    expect(sent.statusCode).toBe(202);
  });

  it("still lets the requester reject (withdraw) their own request → 202", async () => {
    const app = await buildApp();
    const { approvalId } = await makerQuoteWithPendingApproval(app, "REJ");

    const selfReject = await app.inject({ method: "POST", url: `/v1/crm/quotation-approvals/${approvalId}/decide`, headers: makerHeaders(), payload: { decision: "reject", reason: "Withdrawing my own request" } });
    await app.close();
    expect(selfReject.statusCode).toBe(202);
  });

  // Defence in depth: the consumer re-checks maker != checker, so a decide command
  // published by something other than the route (or replayed) cannot self-approve.
  it("consumer refuses a self-approve command that bypasses the route", async () => {
    const app = await buildApp();
    const { approvalId } = await makerQuoteWithPendingApproval(app, "BYPASS");

    await queue.publish(COMMANDS.decideQuotationApproval, {
      messageId: randomUUID(), type: COMMANDS.decideQuotationApproval, tenantId: TENANT, actorId: MAKER,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: approvalId, tenantId: TENANT, decision: "approve", reason: null, approver: MAKER, expectedVersion: 1 },
    });
    await drainQueue();

    const rows = await scoped((tx) => tx<Array<{ status: string }>>`SELECT status FROM crm.quotation_approvals WHERE id = ${approvalId}`);
    await app.close();
    expect(rows[0]!.status).toBe("pending");
  });
});
