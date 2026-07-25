/**
 * SVC-035 — supplementary demand HTTP integration against the dev DB.
 *
 * Proves: create (limit-capped) → maker-checker approve (self-approve blocked) →
 * the target budget's BE + RE rise and availability is recomputed; reject path;
 * RLS isolation; role gating. Reappropriation (the other half of SVC-035) is
 * covered by reappropriation.test.ts + reappropriation-transfer.test.ts.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBudgets } from "../src/modules/budget/schema.js";
import { financeSupplementaryDemands } from "../src/modules/budget/supplementary-schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000fa035";
const TENANT_B = "aaaaaaaa-1111-4000-8000-0000000fb035";
const MAKER   = "00000000-aaaa-4000-8000-00000000a035";
const CHECKER = "00000000-aaaa-4000-8000-00000000c035";
const HEAD    = "00000000-bbbb-4000-8000-00000000a035";
const BUDGET  = "00000000-dddd-4000-8000-00000000a035";
const FY = "2028-29";

function token(tenant: string, roles: string[], sub: string) {
  return signToken({ sub, tid: tenant, roles, sid: "sess-supp" }, SECRET);
}
const officer = (t = TENANT_A, sub = MAKER) => ({ authorization: `Bearer ${token(t, ["finance_officer"], sub)}` });
const admin = (t = TENANT_A, sub = CHECKER) => ({ authorization: `Bearer ${token(t, ["finance_admin"], sub)}` });

async function seedBudget() {
  await scoped(TENANT_A, (tx) => tx.delete(financeSupplementaryDemands).where(eq(financeSupplementaryDemands.fy, FY)));
  await scoped(TENANT_B, (tx) => tx.delete(financeSupplementaryDemands).where(eq(financeSupplementaryDemands.fy, FY)));
  await scoped(TENANT_A, (tx) => tx.delete(financeBudgets).where(eq(financeBudgets.id, BUDGET)));
  await scoped(TENANT_A, (tx) => tx.insert(financeBudgets).values({
    id: BUDGET, tenantId: TENANT_A, headId: HEAD, fy: FY,
    beMinor: 1000000000n, reMinor: 1000000000n, allocatedMinor: 0n, utilisedMinor: 200000000n,
    currency: "INR", createdBy: MAKER, updatedBy: MAKER,
  }));
}
beforeEach(seedBudget);
afterAll(async () => {
  await scoped(TENANT_A, (tx) => tx.delete(financeSupplementaryDemands).where(eq(financeSupplementaryDemands.fy, FY)));
  await scoped(TENANT_A, (tx) => tx.delete(financeBudgets).where(eq(financeBudgets.id, BUDGET)));
  await sqlClient.end();
});

const body = {
  fy: FY, budgetId: BUDGET, headId: HEAD, amountMinor: 500000000, limitMinor: 600000000,
  kind: "supplementary", authority: "MoF supplementary sanction 07/2028", reason: "shortfall in O&M provision",
};

describe("SVC-035 supplementary — flow", () => {
  it("approve raises BE + RE and recomputes availability; self-approve blocked", async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({ method: "POST", url: "/v1/finance/supplementary-demands", headers: officer(), payload: body });
      expect(created.statusCode).toBe(201);
      expect(created.json().data.status).toBe("pending_approval");
      const id = created.json().data.id as string;

      // maker cannot self-approve
      const self = await app.inject({
        method: "PATCH", url: `/v1/finance/supplementary-demands/${id}/approve`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
      });
      expect(self.statusCode).toBe(409);
      expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");

      // distinct checker approves
      const appr = await app.inject({ method: "PATCH", url: `/v1/finance/supplementary-demands/${id}/approve`, headers: admin() });
      expect(appr.statusCode).toBe(200);
      expect(appr.json().data.status).toBe("approved");
      // available before = re(1000) - util(200) = 800; after supplementary 500 → 1300 (crore in paise)
      expect(appr.json().newAvailableMinor).toBe("1300000000");

      // budget BE + RE rose by 500
      const budget = (await scoped(TENANT_A, (tx) => tx.select().from(financeBudgets).where(eq(financeBudgets.id, BUDGET))))[0];
      expect(budget?.beMinor).toBe(1500000000n);
      expect(budget?.reMinor).toBe(1500000000n);
      expect(budget?.utilisedMinor).toBe(200000000n); // unchanged

      const events = await scoped(TENANT_A, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A)));
      expect(events.some((e) => e.eventType === "finance.budget.supplementary_approved"
        && (e.payload as { supplementaryId?: string }).supplementaryId === id)).toBe(true);
    } finally { await app.close(); }
  });

  it("rejects a supplementary above its limit with 400 LIMIT_EXCEEDED", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/supplementary-demands", headers: officer(),
        payload: { ...body, amountMinor: 700000000, limitMinor: 600000000 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("LIMIT_EXCEEDED");
    } finally { await app.close(); }
  });

  it("reject path leaves the budget untouched", async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({ method: "POST", url: "/v1/finance/supplementary-demands", headers: officer(), payload: body });
      const id = created.json().data.id as string;
      const rej = await app.inject({
        method: "PATCH", url: `/v1/finance/supplementary-demands/${id}/reject`, headers: admin(),
        payload: { reason: "not supported by revenue trend" },
      });
      expect(rej.statusCode).toBe(200);
      expect(rej.json().data.status).toBe("rejected");
      const budget = (await scoped(TENANT_A, (tx) => tx.select().from(financeBudgets).where(eq(financeBudgets.id, BUDGET))))[0];
      expect(budget?.reMinor).toBe(1000000000n); // unchanged
    } finally { await app.close(); }
  });

  it("RLS: tenant B cannot see tenant A supplementary demands", async () => {
    const app = await buildApp();
    try {
      await app.inject({ method: "POST", url: "/v1/finance/supplementary-demands", headers: officer(), payload: body });
      const listB = await app.inject({ method: "GET", url: `/v1/finance/supplementary-demands?fy=${FY}`, headers: admin(TENANT_B, CHECKER) });
      expect(listB.statusCode).toBe(200);
      expect((listB.json().data as unknown[]).length).toBe(0);
    } finally { await app.close(); }
  });

  it("403 for a non-finance role", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/supplementary-demands",
        headers: { authorization: `Bearer ${token(TENANT_A, ["citizen"], MAKER)}` }, payload: body,
      });
      expect(res.statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
