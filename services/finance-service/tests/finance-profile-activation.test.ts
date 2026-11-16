/**
 * Tenant-profile finance activation (stacks on S4): tenant.onboarded materialises the profile's INITIAL gl.finance_settings
 * (coa_template, accounting_basis, budget_control, profile_code) in the same transaction that resolves the template and seeds
 * the heads. Pure section needs no DB; the "real Postgres" section needs finance_svc (FORCE RLS) + migrations 0166/0169.
 *
 * #1 safety property under test: govt (govt_dept) onboarding is byte-identical -- flag off AND on writes NO finance_settings
 * row and seeds exactly standardGlHeads(). Expected values come from the tenant-profile catalogue (effectiveSettings), never
 * a second hard-coded copy: a placeholder (active:false) profile resolves LEGACY until the catalogue activates it.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { effectiveSettings, getProfile } from "@civitasone/tenant-profile";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeSettings } from "../src/modules/approvals/schema.js";
import { glHeadsForTemplate, seedGlHeadsTx, standardGlHeads } from "../src/modules/gl/standard-heads.js";
import { resolveCoaTemplateTx, activateFinanceProfileTx, profileFinanceSettings } from "../src/modules/gl/coa-template.js";

const ACTOR = randomUUID();
const PROFILES = ["govt_dept", "govt_small_office", "psu", "section8", "small_office"] as const;
const saved = process.env.TENANT_PROFILES_ENABLED;
afterEach(() => { if (saved === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = saved; });
afterAll(async () => { await sqlClient.end(); });

describe("finance activation pure: profileFinanceSettings", () => {
  it("flag off => null for every profile (no write)", () => {
    for (const p of PROFILES) expect(profileFinanceSettings(p, false)).toBeNull();
  });
  it("govt_dept and unknown/absent profile => null with the flag ON (legacy; no row written)", () => {
    expect(profileFinanceSettings("govt_dept", true)).toBeNull();
    expect(profileFinanceSettings("nope", true)).toBeNull();
    expect(profileFinanceSettings(undefined, true)).toBeNull();
  });
  it.each(PROFILES)("%s (flag on) mirrors the catalogue's effectiveSettings", (code) => {
    const eff = effectiveSettings(code, true);
    const got = profileFinanceSettings(code, true);
    const legacy = eff.coaTemplate === "govt" && eff.accountingBasis === "cash" && eff.budgetControl === "mandatory" && eff.coaPacks.length === 0;
    if (legacy) expect(got).toBeNull();
    else expect(got).toEqual({ profileCode: getProfile(code)!.code, settings: eff });
  });
  it("govt_small_office (office-pack) is the one govt profile that carries a row (profile_code drives the pack)", () => {
    expect(profileFinanceSettings("govt_small_office", true)?.settings.coaTemplate).toBe("govt");
    expect(profileFinanceSettings("govt_small_office", true)?.settings.coaPacks).toEqual(["office-pack"]);
  });
});

describe("finance activation real Postgres: onboard sequence (activate -> resolve -> seed, one tx)", () => {
  // Mirrors tenant-onboard/consumer.ts exactly.
  const onboard = (t: string, profileCode: string | undefined) => scoped(t, async (tx) => {
    await activateFinanceProfileTx(tx, t, profileCode, ACTOR);
    const { template, packs } = await resolveCoaTemplateTx(tx, t);
    return seedGlHeadsTx(tx, t, template, packs, ACTOR);
  });
  const settingsRows = (t: string) => scoped(t, (tx) => tx.select().from(financeSettings).where(eq(financeSettings.tenantId, t)));
  const heads = (t: string) => scoped(t, (tx) => tx.select().from(financeHeads).where(eq(financeHeads.tenantId, t)));
  const codes = (rs: Array<{ code: string }>) => rs.map((r) => r.code).sort();

  it.each([false, true])("GOVT BYTE-IDENTICAL (flag %s): govt_dept writes no settings row and seeds exactly standardGlHeads()", async (flagOn) => {
    if (flagOn) process.env.TENANT_PROFILES_ENABLED = "true"; else delete process.env.TENANT_PROFILES_ENABLED;
    const t = randomUUID();
    await onboard(t, "govt_dept");
    expect(await settingsRows(t)).toHaveLength(0);
    const got = await heads(t);
    expect(codes(got)).toEqual(standardGlHeads().map((h) => h.code).sort());
    expect(got.every((r) => r.statementClass === null)).toBe(true);
  });

  it("flag OFF: every profile (section8/small_office/psu included) is a no-op -- no row, govt heads", async () => {
    delete process.env.TENANT_PROFILES_ENABLED;
    for (const p of PROFILES) {
      const t = randomUUID();
      await onboard(t, p);
      expect(await settingsRows(t)).toHaveLength(0);
      expect(codes(await heads(t))).toEqual(codes(standardGlHeads()));
    }
  });

  it.each(["psu", "section8", "small_office"] as const)("flag ON: %s gets the catalogue's template/basis and the matching heads", async (code) => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    const eff = effectiveSettings(code, true);
    const t = randomUUID();
    await onboard(t, code);
    const rows = await settingsRows(t);
    if (eff.coaTemplate === "govt" && eff.accountingBasis === "cash") {
      // Placeholder / inactive profile: LEGACY until the catalogue activates it -- no row, govt chart.
      expect(rows).toHaveLength(0);
      expect(codes(await heads(t))).toEqual(codes(standardGlHeads()));
      return;
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ coaTemplate: eff.coaTemplate, accountingBasis: eff.accountingBasis, budgetControl: eff.budgetControl, profileCode: code, version: 1 });
    expect(codes(await heads(t))).toEqual(codes(glHeadsForTemplate(eff.coaTemplate)));
  });

  it("idempotent: a redelivery changes nothing", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    const t = randomUUID();
    await onboard(t, "govt_small_office");
    const before = await settingsRows(t); const hb = codes(await heads(t));
    await onboard(t, "govt_small_office");
    expect(await settingsRows(t)).toEqual(before);
    expect(codes(await heads(t))).toEqual(hb);
  });

  it("never overwrites a tenant's non-default settings (changed row, or version > 1)", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    const t = randomUUID();
    await scoped(t, (tx) => tx.insert(financeSettings).values({ tenantId: t, coaTemplate: "commercial", accountingBasis: "accrual", profileCode: "custom_x", updatedBy: ACTOR }));
    await onboard(t, "govt_small_office");
    expect(await settingsRows(t)).toMatchObject([{ coaTemplate: "commercial", accountingBasis: "accrual", profileCode: "custom_x", version: 1 }]);
    const t2 = randomUUID();
    await scoped(t2, (tx) => tx.insert(financeSettings).values({ tenantId: t2, version: 3, updatedBy: ACTOR }));
    await onboard(t2, "govt_small_office");
    expect(await settingsRows(t2)).toMatchObject([{ profileCode: "govt_dept", version: 3 }]);
  });

  it("a pristine default row (version 1, all defaults) IS upgraded to the profile, bumping version", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    const t = randomUUID();
    await scoped(t, (tx) => tx.insert(financeSettings).values({ tenantId: t, updatedBy: ACTOR }));
    await onboard(t, "govt_small_office");
    expect(await settingsRows(t)).toMatchObject([{ profileCode: "govt_small_office", version: 2 }]);
  });
});
