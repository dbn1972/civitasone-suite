/**
 * HIGH — GET /v1/finance/budgets (list) and GET /v1/finance/balance always
 * reported allocated/sanctioned/balance as "0" and status "exhausted" for
 * EVERY budget, regardless of real BE/RE/utilisation.
 *
 * Root cause: budget.finance_budgets.allocated_minor is hard-coded to 0n at
 * creation (consumer.ts's budgetCreate handler) and is never written by any
 * other write path in this service (re-appropriation only ever touches
 * re_minor via repo.transferBudgetReMinorGuarded; supplementary-demand
 * approval only ever touches be_minor/re_minor via
 * applySupplementaryToBudget). Since 0n is not nullish,
 * `row.allocatedMinor ?? row.beMinor ?? 0n` (queries.ts) never fell through
 * to beMinor, so "allocated" silently read 0 for every budget.
 *
 * re_minor (Revised Estimate) is the domain's real authoritative "currently
 * sanctioned" figure: it starts equal to be_minor at creation, is raised by
 * supplementary-demand approval, and is debited/credited by re-appropriation
 * transfers — and it is already what the real spend-gating logic trusts
 * (repo.ts's incrementBudgetUtilisedGuarded and domain.ts's
 * assertReappropriationValid both gate on `re_minor - utilised_minor`, never
 * on allocatedMinor). This test proves the query/route layer now derives
 * "allocated" from re_minor instead of the dead allocated_minor column,
 * across a fresh budget, a partially-utilised one, both legs of a
 * re-appropriation, and a supplementary-demand grant that should flip a
 * fully-exhausted budget back to active.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue, cache } from "../src/shared/infra.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import { scoped } from "./_tenant.js";
import { financeBudgets, financeHeads } from "../src/modules/budget/schema.js";
import { financeSupplementaryDemands } from "../src/modules/budget/supplementary-schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT  = "aaaaaaaa-1111-4000-8000-00000a10c001";
const MAKER   = "00000000-aaaa-4000-8000-00000a10c001";
const CHECKER = "00000000-bbbb-4000-8000-00000a10c001";
const FY = "2027-28";

// One head + budget per scenario, all under the same tenant/FY.
const HEAD_FRESH    = "a1000000-bbbb-4000-8000-00000a10c001";
const BUDGET_FRESH  = "a1000000-dddd-4000-8000-00000a10c001";
const HEAD_PARTIAL   = "a2000000-bbbb-4000-8000-00000a10c001";
const BUDGET_PARTIAL = "a2000000-dddd-4000-8000-00000a10c001";
const HEAD_SRC    = "a3000000-bbbb-4000-8000-00000a10c001";
const BUDGET_SRC  = "a3000000-dddd-4000-8000-00000a10c001";
const HEAD_TGT    = "a3000000-bbbb-4000-8000-00000a10c002";
const BUDGET_TGT  = "a3000000-dddd-4000-8000-00000a10c002";
const HEAD_SUPP   = "a4000000-bbbb-4000-8000-00000a10c001";
const BUDGET_SUPP = "a4000000-dddd-4000-8000-00000a10c001";

function token(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-budget-summary" }, SECRET);
}
const reader = () => ({ authorization: `Bearer ${token(["finance_officer"], MAKER)}` });
const officer = () => ({ authorization: `Bearer ${token(["finance_officer"], MAKER)}` });
const admin   = () => ({ authorization: `Bearer ${token(["finance_admin"], CHECKER)}` });

async function drain() {
  await (queue as MemoryQueue).drain();
}

// listBudgetSummaries caches under the "budgets" resource for 60s
// (queries.ts's cache.getOrLoad). Neither the re-appropriation nor the
// supplementary-approval command/consumer invalidates that LIST-resource key
// (only the single-budget "budget:<id>" key, via cache.invalidate) -- a
// separate, pre-existing staleness gap, not the allocatedMinor bug this test
// targets. Force a fresh read after seeding and after any in-test mutation so
// this test isolates the fix under test instead of tripping over that gap.
async function resetBudgetsCache() {
  await cache.invalidateResource(TENANT, "budgets");
}

async function seed() {
  await scoped(TENANT, (tx) => tx.delete(financeSupplementaryDemands).where(eq(financeSupplementaryDemands.fy, FY)));
  for (const id of [BUDGET_FRESH, BUDGET_PARTIAL, BUDGET_SRC, BUDGET_TGT, BUDGET_SUPP]) {
    await scoped(TENANT, (tx) => tx.delete(financeBudgets).where(eq(financeBudgets.id, id)));
  }
  // fk_fbudgets_head requires a parent finance_heads row before finance_budgets
  // can reference it (migrations/0055_add_foreign_keys.sql).
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values([
    { id: HEAD_FRESH, tenantId: TENANT, code: "9100-FRESH", name: "Fresh Head", level: 2, createdBy: MAKER, updatedBy: MAKER },
    { id: HEAD_PARTIAL, tenantId: TENANT, code: "9200-PART", name: "Partially Utilised Head", level: 2, createdBy: MAKER, updatedBy: MAKER },
    { id: HEAD_SRC, tenantId: TENANT, code: "9300-SRC", name: "Reappropriation Source Head", level: 2, createdBy: MAKER, updatedBy: MAKER },
    { id: HEAD_TGT, tenantId: TENANT, code: "9300-TGT", name: "Reappropriation Target Head", level: 2, createdBy: MAKER, updatedBy: MAKER },
    { id: HEAD_SUPP, tenantId: TENANT, code: "9400-SUPP", name: "Supplementary Head", level: 2, createdBy: MAKER, updatedBy: MAKER },
  ]).onConflictDoNothing());

  await scoped(TENANT, (tx) => tx.insert(financeBudgets).values([
    // Fresh: BE=RE=50,00,000.00 (paise), 0% utilised.
    { id: BUDGET_FRESH, tenantId: TENANT, headId: HEAD_FRESH, fy: FY,
      beMinor: 500_000_000n, reMinor: 500_000_000n, allocatedMinor: 0n, utilisedMinor: 0n,
      currency: "INR", createdBy: MAKER, updatedBy: MAKER },
    // Partially utilised: BE=RE=1,00,00,000.00, 30% utilised.
    { id: BUDGET_PARTIAL, tenantId: TENANT, headId: HEAD_PARTIAL, fy: FY,
      beMinor: 1_000_000_000n, reMinor: 1_000_000_000n, allocatedMinor: 0n, utilisedMinor: 300_000_000n,
      currency: "INR", createdBy: MAKER, updatedBy: MAKER },
    // Re-appropriation source: RE=1,00,00,000.00, 20,00,000.00 utilised -> 80,00,000.00 savings.
    { id: BUDGET_SRC, tenantId: TENANT, headId: HEAD_SRC, fy: FY,
      beMinor: 1_000_000_000n, reMinor: 1_000_000_000n, allocatedMinor: 0n, utilisedMinor: 200_000_000n,
      currency: "INR", createdBy: MAKER, updatedBy: MAKER },
    // Re-appropriation target: RE=30,00,000.00, 10,00,000.00 utilised.
    { id: BUDGET_TGT, tenantId: TENANT, headId: HEAD_TGT, fy: FY,
      beMinor: 300_000_000n, reMinor: 300_000_000n, allocatedMinor: 0n, utilisedMinor: 100_000_000n,
      currency: "INR", createdBy: MAKER, updatedBy: MAKER },
    // Supplementary target: BE=RE=1,00,00,000.00, FULLY utilised (genuinely exhausted pre-grant).
    { id: BUDGET_SUPP, tenantId: TENANT, headId: HEAD_SUPP, fy: FY,
      beMinor: 1_000_000_000n, reMinor: 1_000_000_000n, allocatedMinor: 0n, utilisedMinor: 1_000_000_000n,
      currency: "INR", createdBy: MAKER, updatedBy: MAKER },
  ]));
}

beforeAll(() => {
  registerBudgetConsumers(queue);
});
beforeEach(async () => {
  await seed();
  await resetBudgetsCache();
});
afterAll(async () => {
  await scoped(TENANT, (tx) => tx.delete(financeSupplementaryDemands).where(eq(financeSupplementaryDemands.fy, FY)));
  for (const id of [BUDGET_FRESH, BUDGET_PARTIAL, BUDGET_SRC, BUDGET_TGT, BUDGET_SUPP]) {
    await scoped(TENANT, (tx) => tx.delete(financeBudgets).where(eq(financeBudgets.id, id)));
  }
  await sqlClient.end();
});

describe("GET /v1/finance/budgets (list) reflects real allocated/balance/status", () => {
  it("fresh budget (0% utilised): balance = full RE, status active — not 0/exhausted", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/budgets?limit=50", headers: reader() });
      expect(res.statusCode).toBe(200);
      const row = (res.json() as any[]).find((b) => b.id === BUDGET_FRESH);
      expect(row).toBeTruthy();
      expect(row.sanctionedAmount).toBe("500000000");
      expect(row.balance).toBe("500000000");
      expect(row.status).toBe("active");
      expect(row.beMinor).toBe("500000000");
      expect(row.reMinor).toBe("500000000");
    } finally {
      await app.close();
    }
  });

  it("partially utilised (30%): balance = RE - utilised, status active — not 0/exhausted", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/finance/budgets?limit=50", headers: reader() });
      const row = (res.json() as any[]).find((b) => b.id === BUDGET_PARTIAL);
      expect(row.sanctionedAmount).toBe("1000000000");
      expect(row.balance).toBe("700000000"); // 1,000,000,000 - 300,000,000
      expect(row.status).toBe("active");
    } finally {
      await app.close();
    }
  });

  it("re-appropriation: source debited, target credited, both balances reflect new RE", async () => {
    const app = await buildApp();
    try {
      const re = await app.inject({
        method: "PATCH", url: `/v1/finance/budgets/${BUDGET_TGT}/re`, headers: officer(),
        payload: { fromBudgetId: BUDGET_SRC, amountMinor: 500_000_000, reason: "Q3 shortfall on target head" },
      });
      expect(re.statusCode).toBe(202);
      await drain();
      await resetBudgetsCache();

      const res = await app.inject({ method: "GET", url: "/v1/finance/budgets?limit=50", headers: reader() });
      const rows = res.json() as any[];
      const src = rows.find((b) => b.id === BUDGET_SRC);
      const tgt = rows.find((b) => b.id === BUDGET_TGT);

      // Source: RE 1,000,000,000 - 500,000,000 transferred = 500,000,000; utilised 200,000,000 -> balance 300,000,000.
      expect(src.reMinor).toBe("500000000");
      expect(src.sanctionedAmount).toBe("500000000");
      expect(src.balance).toBe("300000000");
      expect(src.status).toBe("active");

      // Target: RE 300,000,000 + 500,000,000 credited = 800,000,000; utilised 100,000,000 -> balance 700,000,000.
      expect(tgt.reMinor).toBe("800000000");
      expect(tgt.sanctionedAmount).toBe("800000000");
      expect(tgt.balance).toBe("700000000");
      expect(tgt.status).toBe("active");
    } finally {
      await app.close();
    }
  });

  it("supplementary demand: exhausted budget flips to active once the grant is approved", async () => {
    const app = await buildApp();
    try {
      // Pre-grant: fully utilised against RE -- genuinely exhausted.
      const pre = await app.inject({ method: "GET", url: "/v1/finance/budgets?limit=50", headers: reader() });
      const preRow = (pre.json() as any[]).find((b) => b.id === BUDGET_SUPP);
      expect(preRow.sanctionedAmount).toBe("1000000000");
      expect(preRow.balance).toBe("0");
      expect(preRow.status).toBe("exhausted");

      const created = await app.inject({
        method: "POST", url: "/v1/finance/supplementary-demands", headers: officer(),
        payload: {
          fy: FY, budgetId: BUDGET_SUPP, headId: HEAD_SUPP, amountMinor: 500_000_000, limitMinor: 600_000_000,
          kind: "supplementary", authority: "MoF supplementary sanction 09/2027", reason: "year-end shortfall",
        },
      });
      expect(created.statusCode).toBe(202);
      const suppId = created.json().data.id as string;
      await drain();

      const approved = await app.inject({
        method: "PATCH", url: `/v1/finance/supplementary-demands/${suppId}/approve`, headers: admin(),
      });
      expect(approved.statusCode).toBe(202);
      await drain();
      await resetBudgetsCache();

      // Post-grant: BE/RE both raised by 500,000,000 -> 1,500,000,000; utilised unchanged at 1,000,000,000.
      const post = await app.inject({ method: "GET", url: "/v1/finance/budgets?limit=50", headers: reader() });
      const postRow = (post.json() as any[]).find((b) => b.id === BUDGET_SUPP);
      expect(postRow.beMinor).toBe("1500000000");
      expect(postRow.reMinor).toBe("1500000000");
      expect(postRow.sanctionedAmount).toBe("1500000000");
      expect(postRow.balance).toBe("500000000");
      expect(postRow.status).toBe("active");
    } finally {
      await app.close();
    }
  });
});

describe("GET /v1/finance/budgets/:id reflects real balanceMinor", () => {
  // The task that requested this fix described this single-item endpoint as
  // unaffected ("balanceMinor=0 happens to be legitimately correct there for
  // unrelated reasons"). That holds only for a zero-utilisation budget: for
  // any budget with real utilisation, this endpoint computed
  // `allocatedMinor - utilisedMinor` = `0 - utilised`, i.e. a NEGATIVE
  // balance — the same dead-column root cause, just a different visible
  // symptom. Proven here and fixed alongside the other two endpoints.
  it("partially utilised budget: balanceMinor is the real remaining balance, not negative", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budgets/${BUDGET_PARTIAL}`, headers: reader() });
      expect(res.statusCode).toBe(200);
      const body = res.json() as any;
      expect(body.balanceMinor).toBe("700000000"); // 1,000,000,000 RE - 300,000,000 utilised
    } finally {
      await app.close();
    }
  });

  it("fresh budget: balanceMinor equals the full RE (raw allocatedMinor field itself stays untouched)", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: `/v1/finance/budgets/${BUDGET_FRESH}`, headers: reader() });
      const body = res.json() as any;
      expect(body.balanceMinor).toBe("500000000");
      // The raw column is untouched by this fix — still honestly 0 (dead column).
      expect(body.allocatedMinor).toBe("0");
    } finally {
      await app.close();
    }
  });
});

describe("GET /v1/finance/balance reflects real allocated/balance", () => {
  it("partially utilised budget: balancePct and balanceMinor derived from RE, not the dead allocated_minor column", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET", url: `/v1/finance/balance?headId=${HEAD_PARTIAL}&fy=${FY}`, headers: reader(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as any;
      expect(body.allocatedMinor).toBe("1000000000");
      expect(body.utilisedMinor).toBe("300000000");
      expect(body.balanceMinor).toBe("700000000");
      expect(body.balancePct).toBeCloseTo(70, 5);
    } finally {
      await app.close();
    }
  });

  it("fresh budget: full balance available, non-zero balancePct", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET", url: `/v1/finance/balance?headId=${HEAD_FRESH}&fy=${FY}`, headers: reader(),
      });
      const body = res.json() as any;
      expect(body.allocatedMinor).toBe("500000000");
      expect(body.balanceMinor).toBe("500000000");
      expect(body.balancePct).toBeCloseTo(100, 5);
    } finally {
      await app.close();
    }
  });
});
