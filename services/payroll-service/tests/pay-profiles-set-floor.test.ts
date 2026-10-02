/**
 * PAY-PROFILES review fix: the HRA floor go-live is an explicit ops step
 * (migration 0054 seeds nothing). setHraFloor -- behind
 * `pnpm payroll:set-hra-floor` -- writes one effective-dated row for the
 * platform default or a tenant, audited, and refuses past / locked / duplicate
 * months. No assertion depends on today's date (currentMonth is injected).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient, scopedRead } from "../src/shared/db.js";
import { setHraFloor, currentMonthIst } from "../src/modules/pay-profiles/set-floor.js";
import { loadAllowanceRuleRows, resolveAllowanceRules, PLATFORM_TENANT_ID } from "../src/modules/pay-profiles/allowance-rules.js";

const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const base = { xMinor: 540_000n, yMinor: 360_000n, zMinor: 180_000n, reason: "7th CPC HRA floor go-live per order 1/2099", actorId: ACTOR, currentMonth: "2099-01" };
const asT = <T>(t: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(t, () => db.transaction(fn));

afterAll(async () => {
  await asT(PLATFORM_TENANT_ID, (tx) => tx.execute(sql`DELETE FROM statutory.allowance_rule_config WHERE tenant_id = ${PLATFORM_TENANT_ID}::uuid AND effective_from >= '2099-01-01'`));
  for (const t of [TENANT, OTHER]) {
    await asT(t, (tx) => tx.execute(sql`DELETE FROM statutory.allowance_rule_config WHERE tenant_id = ${t}::uuid`));
    await asT(t, (tx) => tx.execute(sql`DELETE FROM payroll.payroll_runs WHERE tenant_id = ${t}::uuid`));
  }
  await sqlClient.end();
});

describe("currentMonthIst", () => {
  it("uses India Standard Time (UTC+05:30) at the month boundary", () => {
    expect(currentMonthIst(new Date("2026-10-31T18:29:59Z"))).toBe("2026-10"); // 23:59:59 IST
    expect(currentMonthIst(new Date("2026-10-31T18:30:00Z"))).toBe("2026-11"); // 00:00 IST, 1 Nov
    expect(currentMonthIst(new Date("2026-12-31T19:00:00Z"))).toBe("2027-01");
  });
});

describe("setHraFloor (payroll:set-hra-floor)", () => {
  it("platform default: every tenant inherits it from the explicit month, not before; audited", async () => {
    const r = await setHraFloor({ ...base, tenantId: null, effectiveMonth: "2099-03" });
    expect(r).toMatchObject({ scope: "platform", effectiveFrom: "2099-03-01" });
    const rows = await runWithTenant(OTHER, () => scopedRead((tx) => loadAllowanceRuleRows(tx, OTHER)));
    expect(resolveAllowanceRules(rows, OTHER, "2099-02").hraFloorMinor.X).toBe(0n);
    expect(resolveAllowanceRules(rows, OTHER, "2099-03")).toMatchObject({ hraFloorMinor: { X: 540_000n, Y: 360_000n, Z: 180_000n }, sources: { hraFloor: { X: "platform" } } });
    const audit = await asT(PLATFORM_TENANT_ID, (tx) => tx.execute(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${r.id}`)) as unknown as Array<{ payload: Record<string, unknown> }>;
    expect(audit[0]!.payload).toMatchObject({ action: "create", resourceType: "allowance_rule_config", scope: "platform", effectiveFrom: "2099-03-01" });
  });

  it("tenant scope overrides the platform for that tenant only", async () => {
    await setHraFloor({ ...base, tenantId: TENANT, effectiveMonth: "2099-04", xMinor: 0n });
    const t = resolveAllowanceRules(await runWithTenant(TENANT, () => scopedRead((tx) => loadAllowanceRuleRows(tx, TENANT))), TENANT, "2099-04");
    expect(t.hraFloorMinor).toEqual({ X: 0n, Y: 360_000n, Z: 180_000n });
    const o = resolveAllowanceRules(await runWithTenant(OTHER, () => scopedRead((tx) => loadAllowanceRuleRows(tx, OTHER))), OTHER, "2099-04");
    expect(o.hraFloorMinor.X).toBe(540_000n);
  });

  it("refuses a past month, a locked tenant month, a duplicate month and a missing reason", async () => {
    await expect(setHraFloor({ ...base, tenantId: null, effectiveMonth: "2098-12" })).rejects.toThrow(/MONTH_NOT_IN_FUTURE/);
    // the CURRENT month is refused too, at both scopes (it may already be in a run)
    await expect(setHraFloor({ ...base, tenantId: null, effectiveMonth: "2099-01" })).rejects.toThrow(/MONTH_NOT_IN_FUTURE/);
    await expect(setHraFloor({ ...base, tenantId: TENANT, effectiveMonth: "2099-01" })).rejects.toThrow(/MONTH_NOT_IN_FUTURE/);
    await expect(setHraFloor({ ...base, tenantId: TENANT, effectiveMonth: "2098-06" })).rejects.toThrow(/MONTH_NOT_IN_FUTURE/);
    await asT(TENANT, (tx) => tx.execute(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, created_by, updated_by)
      VALUES (${randomUUID()}::uuid, ${TENANT}::uuid, 'SF-LOCK', '2099-06', ${randomUUID()}::uuid, 'approved', ${ACTOR}::uuid, ${ACTOR}::uuid)`));
    await expect(setHraFloor({ ...base, tenantId: TENANT, effectiveMonth: "2099-06" })).rejects.toThrow(/PERIOD_LOCKED/);
    await expect(setHraFloor({ ...base, tenantId: null, effectiveMonth: "2099-03" })).rejects.toThrow(/RULES_EXIST_FOR_DATE/);
    await expect(setHraFloor({ ...base, tenantId: TENANT, effectiveMonth: "2099-07", reason: "short" })).rejects.toThrow(/REASON_REQUIRED/);
  });
});
