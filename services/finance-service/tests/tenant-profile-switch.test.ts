/**
 * Tenant-type profile switch (docs/design/TENANT-PROFILE-SWITCH.md), slices S2 and S3 on the finance side.
 *
 * The "existing tenants behave unchanged" proofs:
 *   - a tenant with no gl.finance_settings row reads mandatory / govt / cash (SETTINGS_DEFAULTS);
 *   - the column defaults of migration 0166 give an existing row the same values;
 *   - mandatory refuses exactly as before; the govt COA seed is byte-identical to the fixture captured from origin/main.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeSettings } from "../src/modules/approvals/schema.js";
import { financeHeads, financeBudgets } from "../src/modules/budget/schema.js";
import {
  SETTINGS_DEFAULTS, isRelaxingControl, toBudgetControl, toCoaTemplate,
  resolveBasisEffectiveFrom, assertBasisSwitchApprovable, nextAprilFirst, BUDGET_CONTROLS, type BudgetControl,
} from "../src/modules/approvals/domain.js";
import { applySettingsChange, applyPendingBasisSwitchTx, applyFiscalYearActivation } from "../src/modules/approvals/apply.js";
import { loadSettingsTx } from "../src/modules/approvals/repo.js";
import { provisionAction, assertProvisionTx, loadBudgetControlTx, attachBudgetWarnings, NO_BUDGET_PROVISION } from "../src/modules/budget/provision.js";
import { standardGlHeads, accrualStoresHeads, BILL_HEAD_HOA } from "../src/modules/gl/standard-heads.js";

const ACTOR = randomUUID();
afterAll(async () => { await sqlClient.end(); });

describe("S2: finance settings defaults (existing tenants unchanged)", () => {
  it("SETTINGS_DEFAULTS are mandatory / govt / govt_dept / cash", () => {
    expect(SETTINGS_DEFAULTS).toMatchObject({ budgetControl: "mandatory", coaTemplate: "govt", profileCode: "govt_dept", accountingBasis: "cash" });
  });
  it("a tenant with no settings row reads the defaults", async () => {
    const t = randomUUID();
    const s = await scoped(t, (tx) => loadSettingsTx(tx, t));
    expect(s).toMatchObject({ budgetControl: "mandatory", coaTemplate: "govt", profileCode: "govt_dept" });
    expect(await scoped(t, (tx) => loadBudgetControlTx(tx, t))).toBe("mandatory");
  });
  it("migration 0166 column defaults: a row written with only the pre-0166 columns reads mandatory / govt", async () => {
    const t = randomUUID();
    await scoped(t, (tx) => tx.insert(financeSettings).values({ tenantId: t, accountingBasis: "cash", updatedBy: ACTOR }));
    const [row] = await scoped(t, (tx) => tx.select().from(financeSettings).where(eq(financeSettings.tenantId, t)));
    expect(row).toMatchObject({ budgetControl: "mandatory", coaTemplate: "govt", profileCode: "govt_dept" });
  });
  it("the database refuses an unknown budget control and an unknown COA template", async () => {
    const a = randomUUID(); const b = randomUUID();
    await expect(scoped(a, (tx) => tx.insert(financeSettings).values({ tenantId: a, budgetControl: "sometimes", updatedBy: ACTOR }))).rejects.toThrow();
    await expect(scoped(b, (tx) => tx.insert(financeSettings).values({ tenantId: b, coaTemplate: "retail", updatedBy: ACTOR }))).rejects.toThrow();
  });
  it("advisory and off round-trip through the settings row", async () => {
    for (const mode of ["advisory", "off"] as const) {
      const t = randomUUID();
      await scoped(t, (tx) => tx.insert(financeSettings).values({ tenantId: t, budgetControl: mode, updatedBy: ACTOR }));
      expect((await scoped(t, (tx) => loadSettingsTx(tx, t))).budgetControl).toBe(mode);
    }
  });
  it("unknown stored values read as the strictest / default (never looser)", () => {
    expect(toBudgetControl("relaxed")).toBe("mandatory");
    expect(toBudgetControl(undefined)).toBe("mandatory");
    expect(toCoaTemplate("retail")).toBe("govt");
  });
  it("relaxing the budget control needs a second admin; tightening or no change does not", () => {
    const cur = (m: BudgetControl) => ({ ...SETTINGS_DEFAULTS, budgetControl: m });
    const relaxing: Array<[BudgetControl, BudgetControl]> = [["mandatory", "advisory"], ["mandatory", "off"], ["advisory", "off"]];
    for (const [from, to] of relaxing) expect(isRelaxingControl(cur(from), { budgetControl: to }), `${from}->${to}`).toBe(true);
    const direct: Array<[BudgetControl, BudgetControl]> = [["off", "advisory"], ["off", "mandatory"], ["advisory", "mandatory"], ["mandatory", "mandatory"], ["off", "off"]];
    for (const [from, to] of direct) expect(isRelaxingControl(cur(from), { budgetControl: to }), `${from}->${to}`).toBe(false);
    // the controls that were relaxing before are unchanged
    expect(isRelaxingControl(SETTINGS_DEFAULTS, { makerCheckerEnabled: false })).toBe(true);
    expect(isRelaxingControl(SETTINGS_DEFAULTS, { accountingBasis: "accrual" })).toBe(true);
    expect(isRelaxingControl(SETTINGS_DEFAULTS, {})).toBe(false);
  });
});

describe("S2: owner decision 3, approve ahead and apply on the next 1 April (pure rules)", () => {
  it("the effective date is the next 1 April; a mid-year date or any other 1 April is refused", () => {
    expect(nextAprilFirst("2027-03-20")).toBe("2027-04-01");
    expect(nextAprilFirst("2026-10-15")).toBe("2027-04-01");
    expect(nextAprilFirst("2027-04-01")).toBe("2028-04-01");
    expect(resolveBasisEffectiveFrom(undefined, "2026-10-15")).toBe("2027-04-01");
    expect(resolveBasisEffectiveFrom("2027-04-01", "2026-10-15")).toBe("2027-04-01");
    for (const d of ["2026-11-15", "2027-01-01", "2027-04-02", "2027-03-31"]) expect(() => resolveBasisEffectiveFrom(d, "2026-10-15"), d).toThrow(/BASIS_SWITCH_MID_YEAR/);
    expect(() => resolveBasisEffectiveFrom("2028-04-01", "2026-10-15")).toThrow(/BASIS_SWITCH_DATE/);
    expect(() => resolveBasisEffectiveFrom("2026-04-01", "2026-10-15")).toThrow(/BASIS_SWITCH_DATE/);
  });
  it("an approval that arrives on or after the effective date is stale", () => {
    expect(() => assertBasisSwitchApprovable("2027-04-01", "2027-03-31")).not.toThrow();
    expect(() => assertBasisSwitchApprovable("2027-04-01", "2027-04-01")).toThrow(/BASIS_SWITCH_STALE/);
    expect(() => assertBasisSwitchApprovable("2027-04-01", "2027-06-10")).toThrow(/BASIS_SWITCH_STALE/);
    expect(() => assertBasisSwitchApprovable("2027-01-01", "2026-10-15")).toThrow(/BASIS_SWITCH_MID_YEAR/);
  });
});

describe("S2: pending accounting-basis switch, applied at the FY rollover (disposable Postgres)", () => {
  const meta = (t: string) => ({ tenantId: t, actorId: ACTOR, correlationId: `corr-${t.slice(0, 8)}` });
  const read = (t: string) => scoped(t, (tx) => loadSettingsTx(tx, t));
  const request = (t: string, todayIst: string, effective: string | undefined) => scoped(t, (tx) => applySettingsChange(tx, meta(t), {
    changes: { accountingBasis: "accrual" }, reason: "Move to accrual books for the new financial year", accountingBasisEffectiveFrom: effective, todayIst,
  }));
  const rollover = (t: string, date: string) => scoped(t, (tx) => applyPendingBasisSwitchTx(tx, meta(t), date));
  const prev = process.env.TENANT_PROFILES_ENABLED;
  beforeAll(() => { process.env.TENANT_PROFILES_ENABLED = "true"; });
  afterAll(() => { if (prev === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = prev; });

  it("approved in March: stored as pending, still cash, applied on 1 April", async () => {
    const t = randomUUID();
    await request(t, "2027-03-20", "2027-04-01");
    expect(await read(t)).toMatchObject({ accountingBasis: "cash", pendingAccountingBasis: "accrual", pendingBasisEffectiveFrom: "2027-04-01" });
    expect(await rollover(t, "2027-03-31")).toBe(false);
    expect((await read(t)).accountingBasis).toBe("cash");
    expect(await rollover(t, "2027-04-01")).toBe(true);
    expect(await read(t)).toMatchObject({ accountingBasis: "accrual", pendingAccountingBasis: null, pendingBasisEffectiveFrom: null });
    expect(await rollover(t, "2027-04-01")).toBe(false); // idempotent
  });
  it("approved in October: waits for the next 1 April (no date given defaults to it)", async () => {
    const t = randomUUID();
    await request(t, "2026-10-15", resolveBasisEffectiveFrom(undefined, "2026-10-15"));
    expect(await read(t)).toMatchObject({ accountingBasis: "cash", pendingBasisEffectiveFrom: "2027-04-01" });
    expect(await rollover(t, "2026-11-30")).toBe(false);
    expect(await rollover(t, "2027-01-15")).toBe(false);
    expect((await read(t)).accountingBasis).toBe("cash");
    expect(await rollover(t, "2027-04-01")).toBe(true);
    expect((await read(t)).accountingBasis).toBe("accrual");
  });
  it("a mid-year effective date is refused and nothing is stored", async () => {
    const t = randomUUID();
    expect(() => resolveBasisEffectiveFrom("2027-01-01", "2026-10-15")).toThrow(/BASIS_SWITCH_MID_YEAR/);
    await expect(request(t, "2026-10-15", "2027-01-01")).rejects.toThrow(/BASIS_SWITCH_MID_YEAR/);
    expect((await read(t)).pendingAccountingBasis).toBeNull();
  });
  it("a stale approval is refused and the basis stays", async () => {
    const t = randomUUID();
    await expect(request(t, "2027-04-01", "2027-04-01")).rejects.toThrow(/BASIS_SWITCH_STALE/);
    expect(await read(t)).toMatchObject({ accountingBasis: "cash", pendingAccountingBasis: null });
  });
  it("switching back to the current basis cancels a pending switch", async () => {
    const t = randomUUID();
    await request(t, "2026-10-15", "2027-04-01");
    await scoped(t, (tx) => applySettingsChange(tx, meta(t), { changes: { accountingBasis: "cash" }, reason: "Stay on cash books for now", todayIst: "2026-11-02" }));
    expect(await read(t)).toMatchObject({ accountingBasis: "cash", pendingAccountingBasis: null, pendingBasisEffectiveFrom: null });
  });
  it("the FY activation (the 1 April rollover) applies it", async () => {
    const t = randomUUID();
    await scoped(t, (tx) => tx.insert(financeSettings).values({ tenantId: t, blockFyActivationOpenPeriods: false, requireOpeningBalancesForActivation: false, updatedBy: ACTOR }));
    await scoped(t, async (tx) => {
      await tx.execute(sql`INSERT INTO gl.finance_fiscal_years (tenant_id, code, label, start_date, end_date, status, created_by)
        VALUES (${t}::uuid, '2026-27', 'FY 2026-27', '2026-04-01', '2027-03-31', 'active', ${ACTOR}::uuid),
               (${t}::uuid, '2027-28', 'FY 2027-28', '2027-04-01', '2028-03-31', 'draft', ${ACTOR}::uuid)`);
    });
    await request(t, "2027-03-20", "2027-04-01");
    await scoped(t, (tx) => applyFiscalYearActivation(tx, meta(t), { code: "2027-28", reason: "Rollover to FY 2027-28" }));
    expect(await read(t)).toMatchObject({ accountingBasis: "accrual", pendingAccountingBasis: null });
  });
  it("with the flag off the old behaviour stands: the switch is immediate, no date, nothing pending", async () => {
    delete process.env.TENANT_PROFILES_ENABLED;
    try {
      const t = randomUUID();
      await scoped(t, (tx) => applySettingsChange(tx, meta(t), { changes: { accountingBasis: "accrual" }, reason: "Move to accrual books now" }));
      expect(await read(t)).toMatchObject({ accountingBasis: "accrual", pendingAccountingBasis: null });
    } finally { process.env.TENANT_PROFILES_ENABLED = "true"; }
  });
});

describe("S3: provisionAction", () => {
  it("only mandatory refuses; advisory warns; off allows; a debit that needs no provision is always allowed", () => {
    expect(provisionAction("mandatory", true)).toBe("refuse");
    expect(provisionAction("advisory", true)).toBe("warn");
    expect(provisionAction("off", true)).toBe("allow");
    for (const m of BUDGET_CONTROLS) expect(provisionAction(m, false), m).toBe("allow");
  });
});

// A fake tenant-scoped reader: select().from(table).where() resolves to the rows registered for that table.
function fakeTx(opts: { mode?: string; heads: Array<Record<string, unknown>>; budgets: Array<{ headId: string }> }) {
  return {
    select: () => ({
      from: (t: unknown) => ({
        where: () => {
          const rows = t === financeSettings ? (opts.mode === undefined ? [] : [{ m: opts.mode }]) : t === financeHeads ? opts.heads : t === financeBudgets ? opts.budgets : [];
          const p = Promise.resolve(rows) as Promise<unknown[]> & { limit: () => Promise<unknown[]> };
          p.limit = async () => rows;
          return p;
        },
      }),
    }),
  };
}
const HEAD_2515 = { id: "11111111-1111-4111-8111-111111111111", code: "5410", classification: "expense" };
const HEAD_1100 = { id: "22222222-2222-4222-8222-222222222222", code: "1100", classification: "asset" };

describe("S3: assertProvisionTx by budget control (GFR pre-check, Block Development Office, Sohna)", () => {
  const run = (mode: string | undefined, budgets: Array<{ headId: string }> = []) =>
    assertProvisionTx(fakeTx({ ...(mode !== undefined ? { mode } : {}), heads: [HEAD_2515, HEAD_1100], budgets }), "t", ["5410", "1100"], "2026-11-12", "journal");
  it("no settings row (every existing tenant) and mandatory refuse with NO_BUDGET_PROVISION", async () => {
    await expect(run(undefined)).rejects.toThrow(NO_BUDGET_PROVISION);
    await expect(run("mandatory")).rejects.toThrow(NO_BUDGET_PROVISION);
  });
  it("mandatory passes, with no warnings, when the head has a provision", async () => {
    expect(await run("mandatory", [{ headId: HEAD_2515.id }])).toEqual([]);
  });
  it("advisory returns a warning instead of refusing", async () => {
    expect(await run("advisory")).toEqual([{ code: "NO_BUDGET_PROVISION", headCode: "5410", fy: "2026-27" }]);
  });
  it("off returns nothing and does not read the budgets", async () => {
    expect(await run("off")).toEqual([]);
  });
  it("attachBudgetWarnings sets the header only when there are warnings", () => {
    const sent: Record<string, string> = {};
    const reply = { header: (k: string, v: string) => { sent[k] = v; } };
    attachBudgetWarnings(reply, []);
    expect(sent).toEqual({});
    attachBudgetWarnings(reply, [{ code: "NO_BUDGET_PROVISION", headCode: "5410", fy: "2026-27" }]);
    expect(JSON.parse(sent["x-budget-warnings"]!)).toEqual([{ code: "NO_BUDGET_PROVISION", headCode: "5410", fy: "2026-27" }]);
  });
});

describe("govt COA seed is byte-identical to origin/main (snapshot)", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/govt-standard-gl-heads.json", import.meta.url), "utf8"));
  it("standardGlHeads() equals the fixture captured from origin/main, in order", () => {
    expect(JSON.stringify(standardGlHeads())).toBe(JSON.stringify(fixture.standard));
  });
  it("accrualStoresHeads() and the bill-head HoA are unchanged", () => {
    expect(JSON.stringify(accrualStoresHeads())).toBe(JSON.stringify(fixture.accrualStores));
    expect(BILL_HEAD_HOA).toBe(fixture.billHeadHoa);
  });
  it("keeps 2202 General Education as the default bill head for existing tenants (owner decision 4)", () => {
    const h = standardGlHeads().find((x) => x.code === "2202");
    expect(h).toMatchObject({ name: "General Education", classification: "expense", hoaCode: "220201101010101000" });
  });
});
