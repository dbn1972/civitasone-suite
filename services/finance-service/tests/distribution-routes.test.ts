/**
 * SVC-033 — allocation distribution HTTP integration against the dev DB.
 *
 * Proves: original allocation → distribution to subordinate offices, the
 * over-distribution guard (availability recompute), issue + effective-dating,
 * acknowledgement SoD (self-acknowledge blocked), the outbox event, RLS
 * isolation, role gating.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeAllocationDistributions } from "../src/modules/budget/distribution-schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000fa033";
const TENANT_B = "aaaaaaaa-1111-4000-8000-0000000fb033";
const ISSUER   = "00000000-aaaa-4000-8000-00000000a033";
const RECEIVER = "00000000-aaaa-4000-8000-00000000c033";
const HEAD     = "00000000-bbbb-4000-8000-00000000a033";
const OFFICE_HQ = "00000000-cccc-4000-8000-000000000001";
const OFFICE_A  = "00000000-cccc-4000-8000-000000000002";
const OFFICE_B  = "00000000-cccc-4000-8000-000000000003";
const OFFICE_C  = "00000000-cccc-4000-8000-000000000004";
const FY = "2027-28";

function token(tenant: string, roles: string[], sub: string) {
  return signToken({ sub, tid: tenant, roles, sid: "sess-dist" }, SECRET);
}
const officer = (t = TENANT_A, sub = ISSUER) => ({ authorization: `Bearer ${token(t, ["finance_officer"], sub)}` });

async function cleanup() {
  for (const t of [TENANT_A, TENANT_B]) {
    await scoped(t, (tx) => tx.delete(financeAllocationDistributions).where(eq(financeAllocationDistributions.fy, FY)));
    await scoped(t, (tx) => tx.delete(financeBudgetAllocation).where(eq(financeBudgetAllocation.headId, HEAD)));
  }
}
afterAll(async () => { await cleanup(); await sqlClient.end(); });

async function makeAllocation(app: Awaited<ReturnType<typeof buildApp>>, tenant: string, sub: string): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/finance/budget-allocations",
    headers: { authorization: `Bearer ${token(tenant, ["finance_officer"], sub)}` },
    payload: { headId: HEAD, fy: FY, allocatedMinor: 1000000000 },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

describe("SVC-033 allocation distribution — flow", () => {
  it("distributes within the allocation, blocks over-distribution, recomputes availability", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      const allocationId = await makeAllocation(app, TENANT_A, ISSUER);

      // distribute 600 of 1000
      const d1 = await app.inject({
        method: "POST", url: "/v1/finance/allocation-distributions", headers: officer(),
        payload: { allocationId, fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_A, amountMinor: 600000000, conditions: "utilise by Q3" },
      });
      expect(d1.statusCode).toBe(201);
      expect(d1.json().data.status).toBe("draft");
      expect(d1.json().data.conditions).toBe("utilise by Q3");
      const distId = d1.json().data.id as string;

      // distribute 500 more → exceeds remaining 400
      const d2 = await app.inject({
        method: "POST", url: "/v1/finance/allocation-distributions", headers: officer(),
        payload: { allocationId, fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_B, amountMinor: 500000000 },
      });
      expect(d2.statusCode).toBe(409);
      expect(d2.json().code).toBe("DISTRIBUTION_EXCEEDS_ALLOCATION");

      // distribute remaining 400 → ok
      const d3 = await app.inject({
        method: "POST", url: "/v1/finance/allocation-distributions", headers: officer(),
        payload: { allocationId, fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_C, amountMinor: 400000000 },
      });
      expect(d3.statusCode).toBe(201);

      // summary: distributed 1000, remaining 0
      const summary = await app.inject({
        method: "GET", url: `/v1/finance/budget-allocations/${allocationId}/distribution-summary`, headers: officer(),
      });
      expect(summary.statusCode).toBe(200);
      expect(summary.json().distributedMinor).toBe("1000000000");
      expect(summary.json().remainingMinor).toBe("0");

      // issue d1 → event
      const issued = await app.inject({ method: "PATCH", url: `/v1/finance/allocation-distributions/${distId}/issue`, headers: officer() });
      expect(issued.statusCode).toBe(200);
      expect(issued.json().data.status).toBe("issued");

      const events = await scoped(TENANT_A, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A)));
      expect(events.some((e) => e.eventType === "finance.budget.allocation_distributed"
        && (e.payload as { distributionId?: string }).distributionId === distId)).toBe(true);

      // issuer cannot self-acknowledge
      const selfAck = await app.inject({
        method: "PATCH", url: `/v1/finance/allocation-distributions/${distId}/acknowledge`, headers: officer(),
        payload: { note: "self ack" },
      });
      expect(selfAck.statusCode).toBe(409);
      expect(selfAck.json().code).toBe("MAKER_CHECKER_VIOLATION");

      // receiving office (distinct) acknowledges
      const ack = await app.inject({
        method: "PATCH", url: `/v1/finance/allocation-distributions/${distId}/acknowledge`,
        headers: officer(TENANT_A, RECEIVER), payload: { note: "received and noted" },
      });
      expect(ack.statusCode).toBe(200);
      expect(ack.json().data.status).toBe("acknowledged");
      expect(ack.json().data.acknowledgeNote).toBe("received and noted");
    } finally { await app.close(); }
  });

  it("RLS: tenant B cannot see tenant A distributions", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      const allocationId = await makeAllocation(app, TENANT_A, ISSUER);
      await app.inject({
        method: "POST", url: "/v1/finance/allocation-distributions", headers: officer(),
        payload: { allocationId, fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_A, amountMinor: 100000000 },
      });
      const listB = await app.inject({
        method: "GET", url: `/v1/finance/allocation-distributions?fy=${FY}`,
        headers: officer(TENANT_B, RECEIVER),
      });
      expect(listB.statusCode).toBe(200);
      expect((listB.json().data as unknown[]).length).toBe(0);
    } finally { await app.close(); }
  });

  it("rejects a distribution to the same office (distinct-office guard)", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      const allocationId = await makeAllocation(app, TENANT_A, ISSUER);
      const res = await app.inject({
        method: "POST", url: "/v1/finance/allocation-distributions", headers: officer(),
        payload: { allocationId, fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_HQ, amountMinor: 1000 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("INVALID_DISTRIBUTION");
    } finally { await app.close(); }
  });

  it("403 for a non-finance role", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/allocation-distributions",
        headers: { authorization: `Bearer ${token(TENANT_A, ["citizen"], ISSUER)}` },
        payload: { allocationId: OFFICE_A, fromOfficeId: OFFICE_HQ, toOfficeId: OFFICE_A, amountMinor: 1 },
      });
      expect(res.statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
