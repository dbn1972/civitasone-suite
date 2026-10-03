/**
 * GAP-FINANCE-BUDGET-DEMAND-GRANTS-04 — head-wise lines of a demand for grants.
 * Pure rules, the transactional replace (real DB, race-safe) and the routes.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { assertDemandLinesValid, assertDemandEditable, DemandLinesError, replaceDemandLinesTx } from "../src/modules/budget/demand-lines.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000003d1";
const ACTOR = "00000000-aaaa-4000-8000-0000000003d1";
const token = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-demand-lines" }, SECRET);
const DEMAND = "dddddddd-3333-4000-8000-0000000003d1";
const FROZEN = "dddddddd-3333-4000-8000-0000000003d2";
const HEAD_A = "aaaaaaaa-3333-4000-8000-0000000003a1";
const HEAD_B = "bbbbbbbb-3333-4000-8000-0000000003b1";
const MINOR_HEAD = "cccccccc-3333-4000-8000-0000000003c1";

describe("demand lines (pure)", () => {
  it("accepts a split that totals the demand", () => {
    expect(() => assertDemandLinesValid(1000n, [{ headCode: "2202", amountMinor: 600n }, { headCode: "2203", amountMinor: 400n }])).not.toThrow();
  });
  it("rejects empty, non-positive, duplicate and mismatched splits", () => {
    const code = (fn: () => void) => { try { fn(); return "none"; } catch (e) { return (e as DemandLinesError).code; } };
    expect(code(() => assertDemandLinesValid(1000n, []))).toBe("NO_LINES");
    expect(code(() => assertDemandLinesValid(1000n, [{ headCode: "a", amountMinor: 0n }, { headCode: "b", amountMinor: 1000n }]))).toBe("INVALID_LINE_AMOUNT");
    expect(code(() => assertDemandLinesValid(1000n, [{ headCode: "a", amountMinor: 500n }, { headCode: "a", amountMinor: 500n }]))).toBe("DUPLICATE_HEAD");
    expect(code(() => assertDemandLinesValid(1000n, [{ headCode: "a", amountMinor: 999n }]))).toBe("LINES_TOTAL_MISMATCH");
  });
  it("only a draft demand is editable", () => {
    expect(() => assertDemandEditable("draft")).not.toThrow();
    expect(() => assertDemandEditable("approved")).toThrow(DemandLinesError);
  });
});

async function cleanup() {
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM budget.finance_demand_lines WHERE tenant_id = ${TENANT}::uuid`));
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM budget.finance_demands WHERE tenant_id = ${TENANT}::uuid`));
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM budget.finance_heads WHERE tenant_id = ${TENANT}::uuid`));
}
async function lines() {
  return scoped(TENANT, async (tx) => {
    const r: any = await tx.execute(sql`SELECT head_code, amount_minor::text AS amount_minor FROM budget.finance_demand_lines WHERE tenant_id = ${TENANT}::uuid AND demand_id = ${DEMAND}::uuid ORDER BY head_code`);
    return Array.isArray(r) ? r : r.rows ?? [];
  });
}
beforeAll(async () => {
  await cleanup();
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO budget.finance_heads (id, tenant_id, code, name, level, classification, created_by, updated_by) VALUES
      (${HEAD_A}::uuid, ${TENANT}::uuid, '2202', 'General Education', 0, 'expense', ${ACTOR}::uuid, ${ACTOR}::uuid),
      (${HEAD_B}::uuid, ${TENANT}::uuid, '2203', 'Technical Education', 0, 'expense', ${ACTOR}::uuid, ${ACTOR}::uuid),
      (${MINOR_HEAD}::uuid, ${TENANT}::uuid, '2202-01', 'Elementary', 1, 'expense', ${ACTOR}::uuid, ${ACTOR}::uuid)`));
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO budget.finance_demands (id, tenant_id, demand_no, service, amount_minor, class, status, created_by, updated_by) VALUES
      (${DEMAND}::uuid, ${TENANT}::uuid, 'D-01', 'Education', 100000, 'voted', 'draft', ${ACTOR}::uuid, ${ACTOR}::uuid),
      (${FROZEN}::uuid, ${TENANT}::uuid, 'D-02', 'Health', 50000, 'voted', 'approved', ${ACTOR}::uuid, ${ACTOR}::uuid)`));
});
afterAll(async () => { await cleanup(); await sqlClient.end(); });

const replace = (demandId: string, ls: Array<{ headCode: string; amountMinor: bigint }>) =>
  scoped(TENANT, (tx) => replaceDemandLinesTx(tx, { tenantId: TENANT, demandId, actorId: ACTOR, lines: ls }));

describe("replaceDemandLinesTx (real DB)", () => {
  it("writes the lines with head names and replaces a previous split atomically", async () => {
    await replace(DEMAND, [{ headCode: "2202", amountMinor: 60000n }, { headCode: "2203", amountMinor: 40000n }]);
    expect(await lines()).toEqual([{ head_code: "2202", amount_minor: "60000" }, { head_code: "2203", amount_minor: "40000" }]);
    await replace(DEMAND, [{ headCode: "2202", amountMinor: 100000n }]);
    expect(await lines()).toEqual([{ head_code: "2202", amount_minor: "100000" }]);
  });
  it("refuses a total mismatch, a non-major head, an unknown demand and a non-draft demand, leaving lines untouched", async () => {
    const code = async (p: Promise<unknown>) => { try { await p; return "none"; } catch (e) { return (e as DemandLinesError).code; } };
    expect(await code(replace(DEMAND, [{ headCode: "2202", amountMinor: 1n }]))).toBe("LINES_TOTAL_MISMATCH");
    expect(await code(replace(DEMAND, [{ headCode: "2202-01", amountMinor: 100000n }]))).toBe("UNKNOWN_HEAD");
    expect(await code(replace(randomUUID(), [{ headCode: "2202", amountMinor: 1n }]))).toBe("NOT_FOUND");
    expect(await code(replace(FROZEN, [{ headCode: "2202", amountMinor: 50000n }]))).toBe("DEMAND_NOT_EDITABLE");
    expect(await lines()).toEqual([{ head_code: "2202", amount_minor: "100000" }]);
  });
  it("concurrent edits serialize on the demand lock: the surviving set is exactly one whole, valid split", async () => {
    await Promise.all([
      replace(DEMAND, [{ headCode: "2202", amountMinor: 70000n }, { headCode: "2203", amountMinor: 30000n }]),
      replace(DEMAND, [{ headCode: "2203", amountMinor: 100000n }]),
    ]);
    const l = await lines();
    const total = l.reduce((s: bigint, r: any) => s + BigInt(r.amount_minor), 0n);
    expect(total).toBe(100000n);
    expect([1, 2]).toContain(l.length);
  });
});

describe("demand lines consumer + routes", () => {
  it("the consumer applies the command and audits; a rejected split is a non-retryable error", async () => {
    const handlers = new Map<string, (m: any) => Promise<void>>();
    registerBudgetConsumers({ subscribe: (t: string, h: any) => handlers.set(t, h) } as any);
    const h = handlers.get(COMMANDS.demandLinesSet)!;
    const mk = (ls: unknown) => ({ messageId: randomUUID(), tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), payload: { tenantId: TENANT, demandId: DEMAND, lines: ls } });
    await h(mk([{ headCode: "2202", amountMinor: "25000" }, { headCode: "2203", amountMinor: "75000" }]));
    expect((await lines()).map((r: any) => r.amount_minor)).toEqual(["25000", "75000"]);
    // A rejected split (e.g. the demand changed under a concurrent edit) applies nothing and is audited, not dropped silently.
    const rejected = mk([{ headCode: "2202", amountMinor: "1" }]);
    await h(rejected);
    expect((await lines()).map((r: any) => r.amount_minor)).toEqual(["25000", "75000"]);
    const audits = await scoped(TENANT, async (tx) => {
      const r: any = await tx.execute(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND correlation_id = ${rejected.correlationId}`);
      return Array.isArray(r) ? r : r.rows ?? [];
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].payload).toMatchObject({ action: "set_lines_rejected", outcome: "failure", resourceId: DEMAND, details: { code: "LINES_TOTAL_MISMATCH" } });
  });

  it("GET returns the demand with lines and the reconciliation flag; PUT validates synchronously and publishes", async () => {
    const app = await buildApp();
    try {
      const auth = { authorization: `Bearer ${token(["finance_officer"])}` };
      const get = await app.inject({ method: "GET", url: `/v1/finance/budgets/demand-grants/${DEMAND}`, headers: auth });
      expect(get.statusCode).toBe(200);
      expect(get.json().data).toMatchObject({ demandNo: "D-01", amountMinor: "100000", linesTotalMinor: "100000", linesReconciled: true });
      expect(get.json().data.lines.map((l: any) => l.headName)).toEqual(["General Education", "Technical Education"]);
      expect((await app.inject({ method: "GET", url: `/v1/finance/budgets/demand-grants/${randomUUID()}`, headers: auth })).statusCode).toBe(404);

      const put = (roles: string[], id: string, body: unknown) =>
        app.inject({ method: "PUT", url: `/v1/finance/budgets/demand-grants/${id}/lines`, headers: { authorization: `Bearer ${token(roles)}` }, payload: body as any });
      const ok = [{ headCode: "2202", amountMinor: "100000" }];
      expect((await put(["audit_officer"], DEMAND, { lines: ok })).statusCode).toBe(403);
      expect((await put(["finance_officer"], DEMAND, { lines: [{ headCode: "2202", amountMinor: "5" }] })).json().code).toBe("LINES_TOTAL_MISMATCH");
      expect((await put(["finance_officer"], DEMAND, { lines: [{ headCode: "9999", amountMinor: "100000" }] })).json().code).toBe("UNKNOWN_HEAD");
      expect((await put(["finance_officer"], FROZEN, { lines: [{ headCode: "2202", amountMinor: "50000" }] })).json().code).toBe("DEMAND_NOT_EDITABLE");
      expect((await put(["finance_officer"], DEMAND, { lines: [{ headCode: "2202", amountMinor: "1.5" }] })).statusCode).toBe(400);
      expect((await put(["finance_officer"], DEMAND, { lines: ok })).statusCode).toBe(202);
    } finally { await app.close(); }
  });
});
