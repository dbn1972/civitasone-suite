/**
 * SVC-040 — outcome/output budgeting HTTP integration tests against the dev DB.
 * Mutations are CQRS (202 + queue); consumers are registered on the shared memory
 * queue so drain() materialises writes before subsequent reads/asserts.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
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

async function drain() {
  await (queue as MemoryQueue).drain();
}

async function cleanup() {
  await scoped(TENANT_A, (tx) => tx.delete(financeBudgetOutcomes).where(eq(financeBudgetOutcomes.headId, HEAD)));
  await scoped(TENANT_B, (tx) => tx.delete(financeBudgetOutcomes).where(eq(financeBudgetOutcomes.headId, HEAD)));
}

beforeAll(() => {
  registerBudgetConsumers(queue);
});

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
      const created = await app.inject({
        method: "POST", url: "/v1/finance/budget-outcomes",
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
        payload: createBody,
      });
      expect(created.statusCode).toBe(202);
      const id = created.json().data.id as string;
      await drain();

      const got = await app.inject({
        method: "GET", url: `/v1/finance/budget-outcomes/${id}`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
      });
      expect(got.statusCode).toBe(200);
      expect(got.json().data.status).toBe("active");

      const ach = await app.inject({
        method: "PATCH", url: `/v1/finance/budget-outcomes/${id}/achievement`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
        payload: { achievedValue: 1000 },
      });
      expect(ach.statusCode).toBe(202);
      await drain();

      const self = await app.inject({
        method: "PATCH", url: `/v1/finance/budget-outcomes/${id}/evaluate`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
        payload: { note: "self evaluate blocked" },
      });
      expect(self.statusCode).toBe(202);
      await drain();
      const stillActive = await app.inject({
        method: "GET", url: `/v1/finance/budget-outcomes/${id}`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
      });
      expect(stillActive.json().data.status).toBe("active");

      const evalRes = await app.inject({
        method: "PATCH", url: `/v1/finance/budget-outcomes/${id}/evaluate`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], CHECKER)}` },
        payload: { note: "verified against field reports" },
      });
      expect(evalRes.statusCode).toBe(202);
      await drain();

      const evaluated = await app.inject({
        method: "GET", url: `/v1/finance/budget-outcomes/${id}`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], CHECKER)}` },
      });
      expect(evaluated.json().data.status).toBe("evaluated");
      expect(evaluated.json().data.evaluationRating).toBe("achieved");

      const events = await scoped(TENANT_A, (tx) =>
        tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A)),
      );
      expect(events.some((e) => e.eventType === "finance.budget.outcome_evaluated")).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("blocks achievement updates after evaluation", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: "POST", url: "/v1/finance/budget-outcomes",
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
        payload: createBody,
      });
      expect(created.statusCode).toBe(202);
      const id = created.json().data.id as string;
      await drain();

      await app.inject({
        method: "PATCH", url: `/v1/finance/budget-outcomes/${id}/achievement`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
        payload: { achievedValue: 800 },
      });
      await drain();

      await app.inject({
        method: "PATCH", url: `/v1/finance/budget-outcomes/${id}/evaluate`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], CHECKER)}` },
        payload: { note: "field verified" },
      });
      await drain();

      await app.inject({
        method: "PATCH", url: `/v1/finance/budget-outcomes/${id}/achievement`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
        payload: { achievedValue: 900 },
      });
      await drain();

      const got = await app.inject({
        method: "GET", url: `/v1/finance/budget-outcomes/${id}`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
      });
      expect(got.json().data.status).toBe("evaluated");
      expect(got.json().data.achievedValue).toBe("800");
    } finally {
      await app.close();
    }
  });

  it("enforces tenant isolation on reads", async () => {
    await cleanup();
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: "POST", url: "/v1/finance/budget-outcomes",
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
        payload: createBody,
      });
      expect(created.statusCode).toBe(202);
      const id = created.json().data.id as string;
      await drain();

      const listB = await app.inject({
        method: "GET", url: "/v1/finance/budget-outcomes?fy=2025-26",
        headers: { authorization: `Bearer ${token(TENANT_B, ["finance_admin"], CHECKER)}` },
      });
      expect(listB.statusCode).toBe(200);
      expect((listB.json().data as unknown[]).some((r: any) => r.id === id)).toBe(false);

      const getB = await app.inject({
        method: "GET", url: `/v1/finance/budget-outcomes/${id}`,
        headers: { authorization: `Bearer ${token(TENANT_B, ["finance_admin"], CHECKER)}` },
      });
      expect(getB.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("rejects invalid linkage synchronously", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/budget-outcomes",
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
        payload: { ...createBody, targetValue: 0 },
      });
      expect([400]).toContain(res.statusCode);
    } finally {
      await app.close();
    }
  });

  it("role-gates create", async () => {
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
