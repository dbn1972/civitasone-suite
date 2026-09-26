/**
 * R4 (GFR Rule 10 re-appropriation) + R11 (sanction maker-checker) — HTTP
 * integration against the dev DB for the two synchronous pre-accept checks
 * added to commands.ts in this change (routes.ts itself stays thin and is
 * unchanged; see commands.ts for the actual checks):
 *   - PATCH /v1/finance/budgets/:id/re: source-budget existence + within-
 *     savings (assertReappropriationValid), read-only, no lock. Narrows but
 *     does not fully close the TOCTOU window against a genuinely concurrent
 *     transfer off the same source head -- see distribution-routes.test.ts's
 *     "concurrent distributions" test for why that's an accepted, documented
 *     limit of this class of fix, not a gap to close here.
 *   - PATCH /v1/finance/sanctions/:id/{approve,reject}: approver/rejecter-
 *     distinct (assertSanctionApproverDistinct, R11 SoD), read-only, no lock.
 *
 * Mirrors the harness pattern established in distribution-routes.test.ts /
 * formulation-routes.test.ts: consumers registered on the shared in-memory
 * queue in beforeAll, app.inject() for HTTP, drain() to materialise the async
 * apply before any assertion on domain state that only the consumer writes.
 * Sanction state is asserted via a direct scoped() read (mirroring
 * sanction-maker-checker.test.ts) rather than the HTTP GET, since
 * getSanctionDetail's `status` field passes through mapSanctionStatus for
 * display and is not the raw enum this test cares about.
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
import { financeBudgets, financeSanctions, financeHeads } from "../src/modules/budget/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A  = "aaaaaaaa-1111-4000-8000-0000000fa099";
const MAKER     = "00000000-aaaa-4000-8000-00000000a099";
const CHECKER   = "00000000-aaaa-4000-8000-00000000c099";
const HEAD_SRC  = "00000000-bbbb-4000-8000-00000000a099";
const HEAD_TGT  = "00000000-bbbb-4000-8000-00000000b099";
const SRC_BUDGET = "00000000-dddd-4000-8000-00000000a099";
const TGT_BUDGET = "00000000-dddd-4000-8000-00000000b099";
const FY = "2029-30";

function token(tenant: string, roles: string[], sub: string) {
  return signToken({ sub, tid: tenant, roles, sid: "sess-sr" }, SECRET);
}
const officer = (t = TENANT_A, sub = MAKER) => ({ authorization: `Bearer ${token(t, ["finance_officer"], sub)}` });
const admin = (t = TENANT_A, sub = CHECKER) => ({ authorization: `Bearer ${token(t, ["finance_admin"], sub)}` });

async function drain() {
  await (queue as MemoryQueue).drain();
}

async function sanctionStatus(id: string): Promise<string | undefined> {
  const rows = await scoped(TENANT_A, (tx) => tx.select().from(financeSanctions).where(eq(financeSanctions.id, id)));
  return rows[0]?.status;
}

async function seed() {
  await scoped(TENANT_A, (tx) => tx.delete(financeSanctions).where(eq(financeSanctions.headId, HEAD_SRC)));
  await scoped(TENANT_A, (tx) => tx.delete(financeBudgets).where(eq(financeBudgets.fy, FY)));
  await scoped(TENANT_A, (tx) => tx.delete(financeHeads).where(eq(financeHeads.id, HEAD_SRC)));
  await scoped(TENANT_A, (tx) => tx.delete(financeHeads).where(eq(financeHeads.id, HEAD_TGT)));
  // fk_fbudgets_head (migrations/0055_add_foreign_keys.sql) requires a parent
  // finance_heads row before finance_budgets can reference it (same gotcha
  // documented in supplementary-routes.test.ts / reappropriation-transfer.test.ts).
  await scoped(TENANT_A, (tx) => tx.insert(financeHeads).values([
    { id: HEAD_SRC, tenantId: TENANT_A, code: "SR-099-SRC", name: "Sanction/Reappropriation test head (source)", level: 2, createdBy: MAKER, updatedBy: MAKER },
    { id: HEAD_TGT, tenantId: TENANT_A, code: "SR-099-TGT", name: "Sanction/Reappropriation test head (target)", level: 2, createdBy: MAKER, updatedBy: MAKER },
  ]).onConflictDoNothing());
  await scoped(TENANT_A, (tx) => tx.insert(financeBudgets).values([
    { id: SRC_BUDGET, tenantId: TENANT_A, headId: HEAD_SRC, fy: FY, beMinor: 100000000n, reMinor: 100000000n, allocatedMinor: 0n, utilisedMinor: 20000000n, currency: "INR", createdBy: MAKER, updatedBy: MAKER },
    { id: TGT_BUDGET, tenantId: TENANT_A, headId: HEAD_TGT, fy: FY, beMinor: 30000000n,  reMinor: 30000000n,  allocatedMinor: 0n, utilisedMinor: 0n,        currency: "INR", createdBy: MAKER, updatedBy: MAKER },
  ]));
}

beforeAll(async () => {
  registerBudgetConsumers(queue);
  await seed();
});
afterAll(async () => {
  await scoped(TENANT_A, (tx) => tx.delete(financeSanctions).where(eq(financeSanctions.headId, HEAD_SRC)));
  await scoped(TENANT_A, (tx) => tx.delete(financeBudgets).where(eq(financeBudgets.fy, FY)));
  await scoped(TENANT_A, (tx) => tx.delete(financeHeads).where(eq(financeHeads.id, HEAD_SRC))).catch(() => {});
  await scoped(TENANT_A, (tx) => tx.delete(financeHeads).where(eq(financeHeads.id, HEAD_TGT))).catch(() => {});
  await sqlClient.end();
});

describe("PATCH /v1/finance/budgets/:id/re — synchronous over-appropriation pre-check", () => {
  it("blocks a re-appropriation exceeding source savings immediately (409), allows a valid one (202 + applies)", async () => {
    const app = await buildApp();
    try {
      // source savings = 100M - 20M(utilised) = 80M; request 90M must fail synchronously.
      const over = await app.inject({
        method: "PATCH", url: `/v1/finance/budgets/${TGT_BUDGET}/re`, headers: officer(),
        payload: { fromBudgetId: SRC_BUDGET, amountMinor: 90000000, reason: "over-draw attempt" },
      });
      expect(over.statusCode).toBe(409);
      expect(over.json().code).toBe("INSUFFICIENT_SAVINGS");

      // balances unchanged -- nothing was ever enqueued for the rejected request.
      const srcAfterOver = await scoped(TENANT_A, (tx) => tx.select().from(financeBudgets).where(eq(financeBudgets.id, SRC_BUDGET)));
      expect(srcAfterOver[0]!.reMinor).toBe(100000000n);

      // a within-savings transfer (50M of 80M available) succeeds and applies.
      const ok = await app.inject({
        method: "PATCH", url: `/v1/finance/budgets/${TGT_BUDGET}/re`, headers: officer(),
        payload: { fromBudgetId: SRC_BUDGET, amountMinor: 50000000, reason: "Q3 shortfall on target head" },
      });
      expect(ok.statusCode).toBe(202);
      await drain();

      const src = await scoped(TENANT_A, (tx) => tx.select().from(financeBudgets).where(eq(financeBudgets.id, SRC_BUDGET)));
      const tgt = await scoped(TENANT_A, (tx) => tx.select().from(financeBudgets).where(eq(financeBudgets.id, TGT_BUDGET)));
      expect(src[0]!.reMinor).toBe(50000000n); // 100M - 50M
      expect(tgt[0]!.reMinor).toBe(80000000n); // 30M + 50M
    } finally { await app.close(); }
  });

  it("404s synchronously when the source budget does not exist", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "PATCH", url: `/v1/finance/budgets/${TGT_BUDGET}/re`, headers: officer(),
        payload: { fromBudgetId: "00000000-0000-4000-8000-0000000000ff", amountMinor: 1000, reason: "bogus source budget" },
      });
      expect(res.statusCode).toBe(404);
    } finally { await app.close(); }
  });
});

describe("PATCH /v1/finance/sanctions/:id/{approve,reject} — synchronous maker-checker pre-check", () => {
  it("blocks self-approve and self-reject immediately (409); a distinct checker can still approve", async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: "POST", url: "/v1/finance/sanctions", headers: officer(),
        payload: { sanctionNo: "SN-SR-099-1", purpose: "Office supplies", headId: HEAD_SRC, amountMinor: 500000 },
      });
      expect(created.statusCode).toBe(202);
      // routes.ts uses the shared sendAccepted() helper for sanctions/budgets
      // (unlike distribution/formulation/outcome/supplementary, which
      // hand-roll `reply.code(202).send({ data: {...} })`), so the accepted
      // envelope is NOT nested under `data` here.
      const id = created.json().id as string;
      await drain();
      expect(await sanctionStatus(id)).toBe("pending_approval");

      // maker cannot self-approve -- assertSanctionApproverDistinct now runs
      // synchronously in commands.ts, so this is rejected before ever
      // reaching the queue: no drain() needed here.
      const selfApprove = await app.inject({
        method: "PATCH", url: `/v1/finance/sanctions/${id}/approve`,
        headers: { authorization: `Bearer ${token(TENANT_A, ["finance_admin"], MAKER)}` },
      });
      expect(selfApprove.statusCode).toBe(409);
      expect(selfApprove.json().code).toBe("MAKER_CHECKER_VIOLATION");

      // maker cannot self-reject either -- same guard, same synchronous check.
      const selfReject = await app.inject({
        method: "PATCH", url: `/v1/finance/sanctions/${id}/reject`, headers: officer(),
        payload: { reason: "self reject attempt" },
      });
      expect(selfReject.statusCode).toBe(409);
      expect(selfReject.json().code).toBe("MAKER_CHECKER_VIOLATION");

      // still pending -- neither self-action changed anything.
      expect(await sanctionStatus(id)).toBe("pending_approval");

      // a distinct checker approves -- happy path still works.
      const approve = await app.inject({ method: "PATCH", url: `/v1/finance/sanctions/${id}/approve`, headers: admin() });
      expect(approve.statusCode).toBe(202);
      await drain();
      expect(await sanctionStatus(id)).toBe("approved");
    } finally { await app.close(); }
  });

  it("a distinct checker can reject (happy path)", async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: "POST", url: "/v1/finance/sanctions", headers: officer(),
        payload: { sanctionNo: "SN-SR-099-2", purpose: "Office supplies (reject path)", headId: HEAD_SRC, amountMinor: 250000 },
      });
      expect(created.statusCode).toBe(202);
      const id = created.json().id as string;
      await drain();

      const reject = await app.inject({
        method: "PATCH", url: `/v1/finance/sanctions/${id}/reject`, headers: admin(),
        payload: { reason: "insufficient justification" },
      });
      expect(reject.statusCode).toBe(202);
      await drain();
      expect(await sanctionStatus(id)).toBe("cancelled");
    } finally { await app.close(); }
  });

  it("404s synchronously when the sanction does not exist", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "PATCH", url: "/v1/finance/sanctions/00000000-0000-4000-8000-0000000000fe/approve", headers: admin(),
      });
      expect(res.statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
