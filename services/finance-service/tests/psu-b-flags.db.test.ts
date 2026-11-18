/**
 * PSU v1 slice B: gl.finance_settings govt_owned / audit_profile (migration 0187) + the psu profile onboarding.
 * Real Postgres (finance_svc, FORCE RLS). The settings route's maker-checker gate is pinned through isRelaxingControl; the
 * guard against flagging a government tenant through assertGovtOwnedValid (the same function the route + apply call).
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeSettings } from "../src/modules/approvals/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { loadSettingsTx } from "../src/modules/approvals/repo.js";
import { SETTINGS_DEFAULTS, isRelaxingControl, assertGovtOwnedValid, toAuditProfile, AUDIT_PROFILES, DomainError } from "../src/modules/approvals/domain.js";
import { activateFinanceProfileTx, resolveCoaTemplateTx } from "../src/modules/gl/coa-template.js";
import { seedGlHeadsTx, glHeadsForTemplate, standardGlHeads } from "../src/modules/gl/standard-heads.js";

const ACTOR = "00000000-cccc-4000-8000-00000000f0b1";
const saved = process.env.TENANT_PROFILES_ENABLED;
afterEach(() => { if (saved === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = saved; });
afterAll(async () => { await sqlClient.end(); });
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? r : (r as { rows: Record<string, unknown>[] }).rows);

const onboard = (t: string, profileCode: string | undefined) => scoped(t, async (tx) => {
  await activateFinanceProfileTx(tx, t, profileCode, ACTOR, randomUUID());
  const { template, packs } = await resolveCoaTemplateTx(tx, t);
  return seedGlHeadsTx(tx, t, template, packs, ACTOR);
});
const settingsRows = (t: string) => scoped(t, (tx) => tx.select().from(financeSettings).where(eq(financeSettings.tenantId, t)));
const heads = (t: string) => scoped(t, (tx) => tx.select().from(financeHeads).where(eq(financeHeads.tenantId, t)));
const codes = (rs: Array<{ code: string }>) => rs.map((r) => r.code).sort();

describe("migration 0187", () => {
  it("adds govt_owned (boolean NOT NULL default false) and audit_profile (text NOT NULL default 'standard'), CHECK validated", async () => {
    const r = rowsOf(await sqlClient`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'gl' AND table_name = 'finance_settings' AND column_name IN ('govt_owned','audit_profile')`);
    const by = Object.fromEntries(r.map((x) => [x.column_name as string, x]));
    expect(by.govt_owned).toMatchObject({ data_type: "boolean", is_nullable: "NO" });
    expect(String(by.govt_owned?.column_default)).toMatch(/false/);
    expect(by.audit_profile).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(String(by.audit_profile?.column_default)).toMatch(/standard/);
    const c = rowsOf(await sqlClient`SELECT convalidated FROM pg_constraint WHERE conrelid = 'gl.finance_settings'::regclass AND conname = 'finance_settings_audit_profile_valid'`);
    expect(c).toHaveLength(1);
    expect(c[0]?.convalidated).toBe(true);
  });
  it("a row without them reads false / standard; the CHECK refuses any other audit_profile", async () => {
    const t = randomUUID();
    await scoped(t, (tx) => tx.insert(financeSettings).values({ tenantId: t, updatedBy: ACTOR }));
    expect(await scoped(t, (tx) => loadSettingsTx(tx, t))).toMatchObject({ govtOwned: false, auditProfile: "standard" });
    for (const a of AUDIT_PROFILES) { const x = randomUUID(); await scoped(x, (tx) => tx.insert(financeSettings).values({ tenantId: x, updatedBy: ACTOR, auditProfile: a })); }
    const y = randomUUID();
    await expect(scoped(y, (tx) => tx.insert(financeSettings).values({ tenantId: y, updatedBy: ACTOR, auditProfile: "other" }))).rejects.toThrow();
  });
});

describe("maker-checker gate (the only API path to the flags)", () => {
  it("defaults off; any change to govtOwned / auditProfile needs a second admin, an unchanged value does not", () => {
    expect(SETTINGS_DEFAULTS).toMatchObject({ govtOwned: false, auditProfile: "standard" });
    expect(isRelaxingControl(SETTINGS_DEFAULTS, { govtOwned: true })).toBe(true);
    expect(isRelaxingControl(SETTINGS_DEFAULTS, { auditProfile: "cag_caro" })).toBe(true);
    expect(isRelaxingControl(SETTINGS_DEFAULTS, { govtOwned: false, auditProfile: "standard" })).toBe(false);
  });
  it("toAuditProfile fails closed to standard", () => {
    expect(toAuditProfile("cag_caro")).toBe("cag_caro");
    expect(toAuditProfile("junk")).toBe("standard");
    expect(toAuditProfile(null)).toBe("standard");
  });
  it("govt_owned is refused on a government (govt chart / no entity type) tenant and accepted on a commercial company", () => {
    expect(() => assertGovtOwnedValid({ govtOwned: true, coaTemplate: "govt", entityType: null })).toThrow(DomainError);
    expect(() => assertGovtOwnedValid({ govtOwned: true, coaTemplate: "commercial", entityType: "llp" })).toThrow(DomainError);
    expect(() => assertGovtOwnedValid({ govtOwned: true, coaTemplate: "commercial", entityType: "company" })).not.toThrow();
    expect(() => assertGovtOwnedValid({ govtOwned: false, coaTemplate: "govt", entityType: null })).not.toThrow();
  });
});

describe("psu profile onboarding (flag on) vs govt (byte-identical)", () => {
  it("a psu tenant gets commercial + accrual + company + govt_owned + cag_caro and the commercial heads", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    const t = randomUUID();
    await onboard(t, "psu");
    const rows = await settingsRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ coaTemplate: "commercial", accountingBasis: "accrual", budgetControl: "advisory", entityType: "company", govtOwned: true, auditProfile: "cag_caro", profileCode: "psu", version: 1 });
    expect(codes(await heads(t))).toEqual(codes(glHeadsForTemplate("commercial")));
    const s = await scoped(t, (tx) => loadSettingsTx(tx, t));
    expect(s).toMatchObject({ coaTemplate: "commercial", entityType: "company", govtOwned: true, auditProfile: "cag_caro" });
  });
  it("psu redelivery leaves the row untouched; a maker-checker-changed psu row is never overwritten", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    const t = randomUUID();
    await onboard(t, "psu");
    const before = await settingsRows(t);
    await onboard(t, "psu");
    expect(await settingsRows(t)).toEqual(before);
  });
  it("flag OFF: psu writes no settings row and seeds the govt heads (no behaviour change)", async () => {
    delete process.env.TENANT_PROFILES_ENABLED;
    const t = randomUUID();
    await onboard(t, "psu");
    expect(await settingsRows(t)).toHaveLength(0);
    expect(codes(await heads(t))).toEqual(codes(standardGlHeads()));
  });
  it.each([false, true])("GOVT BYTE-IDENTICAL (flag %s): govt_dept / govt_small_office / section8 / small_office never get the PSU flags", async (flagOn) => {
    if (flagOn) process.env.TENANT_PROFILES_ENABLED = "true"; else delete process.env.TENANT_PROFILES_ENABLED;
    for (const code of ["govt_dept", "govt_small_office", "section8", "small_office"]) {
      const t = randomUUID();
      await onboard(t, code);
      for (const r of await settingsRows(t)) expect(r, code).toMatchObject({ govtOwned: false, auditProfile: "standard", entityType: null });
    }
    const g = randomUUID();
    await onboard(g, "govt_dept");
    expect(await settingsRows(g)).toHaveLength(0);
    expect(codes(await heads(g))).toEqual(codes(standardGlHeads()));
  });
});
