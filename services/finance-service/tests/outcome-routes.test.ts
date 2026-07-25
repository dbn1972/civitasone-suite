/**
 * SVC-040 — outcome/output budgeting HTTP integration tests against the dev DB.
 *
 * Proves: create → record achievement → maker-checker evaluation (rating COMPUTED
 * from achievement, self-evaluation blocked), the outbox event, RLS tenant
 * isolation (a second tenant cannot see the row), and role gating.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBudgetOutcomes } from "../src/modules/budget/outcome-schema.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000fa040";
const TENANT_B = "aaaaaaaa-1111-4000-8000-0000000fb040";
const MAKER   = "00000000-aaaa-4000-8000-00000000a040";
const CHECKER = "00000000-aaaa-4000-8000-00000000c040";
const HEAD    = "00000000-bbbb-4000-8000-00000000a040";

function token(tenant: string, roles: string[], sub: string) {
  return signToken({ sub, tid: tenant, roles, sid: "sess-out" }, SECRET);
}

async function cleanup() {
  await scoped(TENANT_A, (tx) => tx.delete(financeBudgetOutcomes).where(eq(financeBudgetOutcomes.headId, HEAD)));
  await scoped(TENANT_B, (tx) => tx.delete(financeBudgetOutcomes).where(eq(financeBudgetOutcomes.headId, HEAD)));
}

afterAll(async () => { await cleanup(); await sqlClient.end(); });

const createBody = {
  headId: HEAD, fy: "2025-26",
  outputDesc: "1000 km of rural road resurfaced",
  outcomeDesc: "Improved last-mile connectivity for 40 villages",
  indicator: "km of road resurfaced", unit: "km",
  baselineValue: 0, targetValue: 1000, allocatedMinor: 500000000,
};

describe("SVC-040 outcome budgeting — full flow", () => {
  it("create → record 100% achievement → checker evaluates → rating 'achieved' + outbox event", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      // create as maker (finance_admin so the same identity could also try to self-evaluate)
      const created = await app.inject({
        method: "POST", url: "/v1/finance/budget-outcomes",
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
        payload: createBody,
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().data.id as string;
      expect(created.json().data.status).toBe("active");

      // record full achievement
      const ach = await app.inject({
        method: "PATCH", url: `/v1/finance/budget-outcomes/${id}/achievement`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_officer"], MAKER)}` },
        payload: { achievedValue: 1000 },
      });
      expect(ach.statusCode).toBe(200);
      expect(ach.json().data.achievedValue).toBe("1000");
      expect(ach.json().data.achievementBps).toBe("10000");

      // maker cannot self-evaluate (SoD)
      const self = await app.inject({
        method: "PATCH", url: `/v1/finance/budget-outcomes/${id}/evaluate`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
        payload: { note: "trying to self-certify" },
      });
      expect(self.statusCode).toBe(409);
      expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");

      // distinct checker evaluates → rating computed as 'achieved'
      const evalRes = await app.inject({
        method: "PATCH", url: `/v1/finance/budget-outcomes/${id}/evaluate`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], CHECKER)}` },
        payload: { note: "verified on-site, target met" },
      });
      expect(evalRes.statusCode).toBe(200);
      expect(evalRes.json().rating).toBe("achieved");
      expect(evalRes.json().data.status).toBe("evaluated");
      expect(evalRes.json().data.evaluationRating).toBe("achieved");

      // outbox event emitted
      const events = await scoped(TENANT_A, (tx) => tx.select().from(outboxMessages)
        .where(eq(outboxMessages.tenantId, TENANT_A)));
      expect(events.some((e) => e.eventType === "finance.budget.outcome_evaluated"
        && (e.payload as { outcomeId?: string }).outcomeId === id)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("RLS: a second tenant cannot see the first tenant's outcome", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: "POST", url: "/v1/finance/budget-outcomes",
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
        payload: createBody,
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().data.id as string;

      // tenant B lists → empty
      const listB = await app.inject({
        method: "GET", url: "/v1/finance/budget-outcomes?fy=2025-26",
        headers: { authorization: `Bearer ${token(TENANT_B, ["finance_admin"], CHECKER)}` },
      });
      expect(listB.statusCode).toBe(200);
      expect((listB.json().data as unknown[]).length).toBe(0);

      // tenant B fetch by id → 404
      const getB = await app.inject({
        method: "GET", url: `/v1/finance/budget-outcomes/${id}`,
        headers: { authorization: `Bearer ${token(TENANT_B, ["finance_admin"], CHECKER)}` },
      });
      expect(getB.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("rejects an incoherent linkage (baseline >= target) with 400", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/budget-outcomes",
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
        payload: { ...createBody, baselineValue: 1000, targetValue: 1000 },
      });
      // zod catches target/baseline shape or domain 400s
      expect([400]).toContain(res.statusCode);
    } finally {
      await app.close();
    }
  });

  it("403 for a non-finance role", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/budget-outcomes",
        headers: { authorization: `Bearer ${token(TENANT_A, ["citizen"], MAKER)}` },
        payload: createBody,
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
