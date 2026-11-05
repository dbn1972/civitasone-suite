/**
 * UAT P3 b19 (#2464 delta review should-fix 2): cutting an allocation below
 * committed + expended + approved sanctions is a SYNCHRONOUS 422
 * ALLOCATION_BELOW_COMMITMENTS at POST /v1/finance/budget-allocations, not a 202 that
 * dead-letters in the consumer. Real Postgres (finance_svc, RLS enforced).
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
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-2464-4000-8000-0000000c0001";
const OFFICER = "00000000-aaaa-4000-8000-0000002464c1";
const HEAD = "00000000-bbbb-4000-8000-0000002464c1";
const FY = "2027-28";
const auth = { authorization: `Bearer ${signToken({ sub: OFFICER, tid: TENANT, roles: ["finance_officer"], sid: "alloc-cut" }, SECRET)}` };
const drain = () => (queue as MemoryQueue).drain();
const alloc = async () => (await scoped(TENANT, (tx) => tx.select().from(financeBudgetAllocation).where(eq(financeBudgetAllocation.headId, HEAD))))[0];
const post = (app: Awaited<ReturnType<typeof buildApp>>, allocatedMinor: number, headId = HEAD) =>
  app.inject({ method: "POST", url: "/v1/finance/budget-allocations", headers: auth, payload: { headId, fy: FY, allocatedMinor } });

beforeAll(async () => {
  registerBudgetConsumers(queue);
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({
    id: HEAD, tenantId: TENANT, code: "P3-B19-CUT-HEAD", name: "allocation cut test head", level: 1, createdBy: OFFICER, updatedBy: OFFICER,
  }).onConflictDoNothing());
});
afterAll(async () => {
  await scoped(TENANT, (tx) => tx.delete(financeBudgetAllocation).where(eq(financeBudgetAllocation.headId, HEAD))).catch(() => {});
  await scoped(TENANT, (tx) => tx.delete(financeHeads).where(eq(financeHeads.id, HEAD))).catch(() => {});
  await sqlClient.end();
});

describe("allocation cut below commitments", () => {
  it("is a synchronous 422 (nothing published, allocation unchanged); a cut that clears the floor is accepted", async () => {
    const app = await buildApp();
    try {
      // First allocation: no existing row, always accepted.
      expect((await post(app, 1000000)).statusCode).toBe(202);
      await drain();
      expect((await alloc())!.allocatedMinor).toBe(1000000n);
      // Commit 600000 against it (what a booked bill does).
      await scoped(TENANT, (tx) => tx.update(financeBudgetAllocation).set({ committedMinor: 600000n }).where(eq(financeBudgetAllocation.headId, HEAD)));

      const cut = await post(app, 500000);
      expect(cut.statusCode).toBe(422);
      expect(cut.json().code).toBe("ALLOCATION_BELOW_COMMITMENTS");
      expect(cut.json().message).toContain("600000");
      await drain();
      expect((await alloc())!.allocatedMinor).toBe(1000000n); // not applied, and no dead letter needed

      // Exactly the floor and an increase are fine.
      expect((await post(app, 600000)).statusCode).toBe(202);
      await drain();
      expect((await alloc())!.allocatedMinor).toBe(600000n);
      expect((await post(app, 900000)).statusCode).toBe(202);
      await drain();
      expect((await alloc())!.allocatedMinor).toBe(900000n);
    } finally { await app.close(); }
  });
});
