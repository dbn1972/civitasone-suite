/**
 * Direct-SQL proof that FORCE ROW LEVEL SECURITY on every refund.* table is
 * what actually stops a cross-tenant leak — independent of and unaided by
 * every repo.ts function's own `eq(refundX.tenantId, tenantId)` WHERE clause
 * (see e.g. requests/repo.ts's findByIdQuery, reconciliation/repo.ts's
 * findByIdQuery). That app-level filter is real defense-in-depth and every
 * route test in this suite (http-routes.test.ts, plus the pre-existing
 * domain/integration tests) exercises it, but a suite that only ever queries
 * through those filtered repo functions cannot tell a real RLS policy from a
 * no-op one: TENANT_B's own request always carries `tenantId = TENANT_B`,
 * which would exclude TENANT_A's rows even if RLS silently did nothing at
 * all — the exact hollow-test shape several other services' first RLS
 * attempts fell into tonight.
 *
 * This file bypasses the repo layer entirely and issues a raw, UNFILTERED
 * `SELECT * FROM refund.<table>` after setting only the `app.tenant_id`
 * session GUC the same way db.transaction() does (see @civitasone/db's
 * tenant-scope.ts / raw-tenant-guc.ts) — mimicking the failure mode RLS
 * actually guards against: a future repo function that forgets its own
 * tenant_id filter. With FORCE ROW LEVEL SECURITY in place this must still
 * return zero cross-tenant rows purely from the policy.
 *
 * Proven to have real teeth: with
 *   ALTER TABLE refund.refund_requests NO FORCE ROW LEVEL SECURITY;
 *   ALTER TABLE refund.refund_approvals NO FORCE ROW LEVEL SECURITY;
 *   ALTER TABLE refund.refund_disbursements NO FORCE ROW LEVEL SECURITY;
 * temporarily applied in the isolated test database (refund_svc is the
 * table OWNER, so without FORCE it bypasses RLS like any owner), every test
 * below FAILED — the raw query returned the other tenant's row. FORCE was
 * then restored (ALTER TABLE ... FORCE ROW LEVEL SECURITY) and this file
 * re-run to confirm it passes again; see the PR description's Verification
 * section for the transcript. http-routes.test.ts, by contrast, keeps
 * passing even with FORCE stripped, precisely because it only ever goes
 * through the tenant-filtered HTTP routes — which is exactly the gap this
 * file exists to close.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerRequestConsumers } from "../src/modules/requests/consumer.js";
import { registerProcessingConsumers } from "../src/modules/processing/consumer.js";
import { registerReconciliationConsumers } from "../src/modules/reconciliation/consumer.js";
import { hdr, drainQueue, waitFor, TENANT_A, TENANT_B } from "./support.js";

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

/** Raw, tenant-filter-free read: sets ONLY the RLS session GUC, nothing else. */
async function rawSelectAsTenant(table: string, tenantId: string): Promise<Array<{ id: string; tenant_id: string }>> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return tx.unsafe(`SELECT id, tenant_id FROM refund.${table}`) as unknown as Promise<Array<{ id: string; tenant_id: string }>>;
  });
}

describe("RLS — raw unfiltered query proof (bypasses app-level tenant filters)", () => {
  it("refund_requests: tenant B's raw unfiltered SELECT never returns tenant A's row", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/refund/requests",
      headers: hdr(undefined, TENANT_A),
      payload: {
        applicantName: "RLS Raw Test",
        applicantPhone: "9876588881",
        originalServiceType: "trade_licence",
        originalTransactionRef: "TXN-RLS-1",
        originalAmountMinor: "10000",
        refundAmountMinor: "10000",
        refundReason: "overpayment",
      },
    });
    const { id } = create.json() as { id: string };
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/refund/requests/${id}`, headers: hdr(undefined, TENANT_A) })).statusCode === 200);

    const asTenantA = await rawSelectAsTenant("refund_requests", TENANT_A);
    expect(asTenantA.some((r) => r.id === id)).toBe(true);

    const asTenantB = await rawSelectAsTenant("refund_requests", TENANT_B);
    expect(asTenantB.some((r) => r.id === id)).toBe(false);
  });

  it("refund_approvals: tenant B's raw unfiltered SELECT never returns tenant A's approval row", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/refund/requests",
      headers: hdr(undefined, TENANT_A),
      payload: {
        applicantName: "RLS Raw Approval Test",
        applicantPhone: "9876588882",
        originalServiceType: "trade_licence",
        originalTransactionRef: "TXN-RLS-2",
        originalAmountMinor: "10000",
        refundAmountMinor: "10000",
        refundReason: "overpayment",
      },
    });
    const { id: requestId } = create.json() as { id: string };
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/refund/requests/${requestId}`, headers: hdr(undefined, TENANT_A) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/refund/requests/${requestId}/submit`, headers: hdr(undefined, TENANT_A) });
    await waitFor(async () => {
      const r = await app.inject({ method: "GET", url: `/v1/refund/requests/${requestId}`, headers: hdr(undefined, TENANT_A) });
      return (r.json() as { data: { status: string } }).data.status === "under_review";
    });
    const approve = await app.inject({
      method: "POST",
      url: "/v1/refund/processing/approve",
      headers: hdr(undefined, TENANT_A),
      payload: { requestId, level: 1, remarks: "rls raw test" },
    });
    const { id: approvalId } = approve.json() as { id: string };
    await drainQueue();

    const asTenantA = await rawSelectAsTenant("refund_approvals", TENANT_A);
    expect(asTenantA.some((r) => r.id === approvalId)).toBe(true);

    const asTenantB = await rawSelectAsTenant("refund_approvals", TENANT_B);
    expect(asTenantB.some((r) => r.id === approvalId)).toBe(false);
  });

  it("refund_disbursements: tenant B's raw unfiltered SELECT never returns tenant A's disbursement row", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/refund/requests",
      headers: hdr(undefined, TENANT_A),
      payload: {
        applicantName: "RLS Raw Disbursement Test",
        applicantPhone: "9876588883",
        originalServiceType: "trade_licence",
        originalTransactionRef: "TXN-RLS-3",
        originalAmountMinor: "50000",
        refundAmountMinor: "50000",
        refundReason: "overpayment",
      },
    });
    const { id: requestId } = create.json() as { id: string };
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/refund/requests/${requestId}`, headers: hdr(undefined, TENANT_A) })).statusCode === 200);
    await app.inject({ method: "POST", url: `/v1/refund/requests/${requestId}/submit`, headers: hdr(undefined, TENANT_A) });
    await waitFor(async () => {
      const r = await app.inject({ method: "GET", url: `/v1/refund/requests/${requestId}`, headers: hdr(undefined, TENANT_A) });
      return (r.json() as { data: { status: string } }).data.status === "under_review";
    });
    await app.inject({ method: "POST", url: "/v1/refund/processing/approve", headers: hdr(undefined, TENANT_A), payload: { requestId, level: 1, remarks: "l1" } });
    await drainQueue();
    await app.inject({ method: "POST", url: "/v1/refund/processing/approve", headers: hdr(undefined, TENANT_A), payload: { requestId, level: 2, remarks: "l2" } });
    await waitFor(async () => {
      const r = await app.inject({ method: "GET", url: `/v1/refund/requests/${requestId}`, headers: hdr(undefined, TENANT_A) });
      return (r.json() as { data: { status: string } }).data.status === "approved";
    });

    const initiate = await app.inject({
      method: "POST",
      url: "/v1/refund/disbursements",
      headers: hdr(undefined, TENANT_A),
      payload: {
        requestId,
        bankAccountDetails: { accountNumber: "999", ifscCode: "SBIN0009999", accountHolderName: "RLS Raw" },
        disbursedAmountMinor: "50000",
      },
    });
    const { id: disbId } = initiate.json() as { id: string };
    await waitFor(async () => (await app.inject({ method: "GET", url: `/v1/refund/disbursements/${disbId}`, headers: hdr(undefined, TENANT_A) })).statusCode === 200);

    const asTenantA = await rawSelectAsTenant("refund_disbursements", TENANT_A);
    expect(asTenantA.some((r) => r.id === disbId)).toBe(true);

    const asTenantB = await rawSelectAsTenant("refund_disbursements", TENANT_B);
    expect(asTenantB.some((r) => r.id === disbId)).toBe(false);
  });

  it("a session with NO app.tenant_id set at all sees zero rows across all three tables (fail-closed, not fail-open)", async () => {
    // No set_config call at all -- current_setting('app.tenant_id', true) is
    // NULL, and the policy's `tenant_id = NULLIF(current_setting(...), '')::uuid`
    // compares every row's tenant_id to NULL, which is never true. This is
    // the fail-closed behavior every tenant-scoped table in this service
    // relies on when a caller forgets to set the GUC at all (not just picks
    // the wrong tenant).
    const requests = await sqlClient.unsafe(`SELECT id FROM refund.refund_requests`);
    expect(requests.length).toBe(0);
    const approvals = await sqlClient.unsafe(`SELECT id FROM refund.refund_approvals`);
    expect(approvals.length).toBe(0);
    const disbursements = await sqlClient.unsafe(`SELECT id FROM refund.refund_disbursements`);
    expect(disbursements.length).toBe(0);
  });
});
