/**
 * UAT bundle 23 (DLQ gate): finance.budget.create dead-lettered for tenant A.
 *
 * finance_budgets is UNIQUE (tenant_id, head_id, fy). POST /v1/finance/budgets only checked that the head
 * exists, so a second budget for a head+FY that already had one (UT3H170 / 2026-27, created 2 Nov and
 * re-submitted from the UI on 9 Nov) was answered 202 and then died in the worker on the unique index:
 * retried 5 times, dead-lettered, and the user believed the budget had been created.
 *
 * Now: 409 BUDGET_EXISTS with a headId field error at the request (nothing published); a replay of the same
 * idempotent command is still a 202; and a duplicate that races past the route is a NonRetryableError in the
 * consumer (one delivery) rather than a retry loop.
 */
import { describe, it, expect, afterAll, beforeAll, vi, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { setFinanceSettings, clearFinanceSettings } from "./_finance-settings.js";
import { financeHeads, financeBudgets } from "../src/modules/budget/schema.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = "00000000-aaaa-4000-8000-0000000b23f1";
const HEAD = "aaaaaaaa-2222-4000-8000-0000000b2301";
const FY = "2026-27";
const officer = () => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["finance_officer"], sid: "sess-b23fb" }, SECRET)}` });

async function cleanup() {
  await clearFinanceSettings(TENANT);
  await scoped(TENANT, (tx) => tx.delete(financeBudgets).where(eq(financeBudgets.tenantId, TENANT)));
  await scoped(TENANT, (tx) => tx.delete(financeHeads).where(eq(financeHeads.tenantId, TENANT)));
}

beforeAll(async () => {
  await cleanup();
  await setFinanceSettings(TENANT, { makerCheckerEnabled: false, blockFyActivationOpenPeriods: false });
  await scoped(TENANT, async (tx) => {
    await tx.insert(financeHeads).values({ id: HEAD, tenantId: TENANT, code: "3054-80-800", name: "Maintenance of State Highways", level: 1, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(financeBudgets).values({ id: randomUUID(), tenantId: TENANT, headId: HEAD, fy: FY, beMinor: 25_000_000n, reMinor: 25_000_000n, createdBy: ACTOR, updatedBy: ACTOR });
  });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await cleanup(); await sqlClient.end(); });

async function post(payload: unknown, headers: Record<string, string> = officer()) {
  const app = await buildApp();
  try {
    return await app.inject({ method: "POST", url: "/v1/finance/budgets", headers, payload: payload as object });
  } finally { await app.close(); }
}

describe("POST /v1/finance/budgets duplicate head + FY", () => {
  it("is refused 409 BUDGET_EXISTS at the request, with a headId field error, and publishes nothing", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await post({ headId: HEAD, fy: FY, beMinor: "30000000" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("BUDGET_EXISTS");
    expect(res.json().fieldErrors).toEqual([expect.objectContaining({ field: "headId" })]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("still accepts the same head for a different financial year", async () => {
    const res = await post({ headId: HEAD, fy: "2027-28", beMinor: "30000000" });
    expect(res.statusCode).toBe(202);
  });
});

describe("budgetCreate consumer duplicate (race past the route check)", () => {
  it("is a permanent error: one delivery, dead-lettered, no retries", async () => {
    const q = new MemoryQueue({ maxAttempts: 5 });
    let deliveries = 0;
    const raw = q.subscribe.bind(q);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).subscribe = (t: string, h: (m: unknown) => Promise<void>, o?: unknown) => raw(t, async (m: unknown) => { deliveries += 1; await h(m); }, o as never);
    registerBudgetConsumers(q);
    await q.start();
    const id = randomUUID();
    await q.publish(COMMANDS.budgetCreate, {
      messageId: id, type: COMMANDS.budgetCreate, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${id}`, schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, headId: HEAD, fy: FY, beMinor: 1000 },
    });
    await q.drain();
    await q.stop();
    expect(deliveries).toBe(1);
    expect(q.dlq).toHaveLength(1);
  });
});
