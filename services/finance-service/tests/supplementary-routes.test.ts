/**
 * SVC-035 — supplementary demand HTTP integration against the dev DB.
 * Mutations are CQRS (202 + queue); consumers registered + drain for asserts.
 */
import { describe, it, expect, afterAll, beforeEach, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
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

async function drain() {
  await (queue as MemoryQueue).drain();
}

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

beforeAll(() => {
  registerBudgetConsumers(queue);
});
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

describe("SVC-035 supplementary demand — full flow", () => {
  it("create → self-approve blocked → checker approve raises budget RE/BE + outbox", async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({ method: "POST", url: "/v1/finance/supplementary-demands", headers: officer(), payload: body });
      expect(created.statusCode).toBe(202);
      const id = created.json().data.id as string;
      await drain();

      const pending = await app.inject({ method: "GET", url: `/v1/finance/supplementary-demands/${id}`, headers: officer() });
      expect(pending.json().data.status).toBe("pending_approval");

      const self = await app.inject({
        method: "PATCH", url: `/v1/finance/supplementary-demands/${id}/approve`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
      });
      expect(self.statusCode).toBe(202);
      await drain();
      expect((await app.inject({ method: "GET", url: `/v1/finance/supplementary-demands/${id}`, headers: officer() })).json().data.status)
        .toBe("pending_approval");

      const appr = await app.inject({ method: "PATCH", url: `/v1/finance/supplementary-demands/${id}/approve`, headers: admin() });
      expect(appr.statusCode).toBe(202);
      await drain();

      const approved = await app.inject({ method: "GET", url: `/v1/finance/supplementary-demands/${id}`, headers: admin() });
      expect(approved.json().data.status).toBe("approved");

      const budget = await scoped(TENANT_A, (tx) => tx.select().from(financeBudgets).where(eq(financeBudgets.id, BUDGET)));
      expect(budget[0]!.beMinor).toBe(1500000000n);
      expect(budget[0]!.reMinor).toBe(1500000000n);

      const events = await scoped(TENANT_A, (tx) =>
        tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT_A)),
      );
      expect(events.some((e) => e.eventType === "finance.budget.supplementary_approved")).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("rejects over-limit create synchronously", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/supplementary-demands", headers: officer(),
        payload: { ...body, amountMinor: 700000000 },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("reject path", async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({ method: "POST", url: "/v1/finance/supplementary-demands", headers: officer(), payload: body });
      const id = created.json().data.id as string;
      await drain();

      const rej = await app.inject({
        method: "PATCH", url: `/v1/finance/supplementary-demands/${id}/reject`, headers: admin(),
        payload: { reason: "not justified against RE ceiling" },
      });
      expect(rej.statusCode).toBe(202);
      await drain();
      const got = await app.inject({ method: "GET", url: `/v1/finance/supplementary-demands/${id}`, headers: admin() });
      expect(got.json().data.status).toBe("rejected");
    } finally {
      await app.close();
    }
  });

  it("enforces tenant isolation on list", async () => {
    const app = await buildApp();
    try {
      await app.inject({ method: "POST", url: "/v1/finance/supplementary-demands", headers: officer(), payload: body });
      await drain();
      const listB = await app.inject({ method: "GET", url: `/v1/finance/supplementary-demands?fy=${FY}`, headers: admin(TENANT_B, CHECKER) });
      expect(listB.statusCode).toBe(200);
      expect((listB.json().data as unknown[]).length).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("role-gates create", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST", url: "/v1/finance/supplementary-demands",
        headers: { authorization: `Bearer ${token(TENANT_A, ["citizen"], MAKER)}` },
        payload: body,
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
