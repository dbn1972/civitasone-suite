/**
 * Tenant-profile slice S4 (docs/design/TENANT-PROFILE-SWITCH.md 2.3 / 7): template-keyed COA seeding + statement_class
 * (migration 0169). Pure section needs no DB; the "real Postgres" section needs finance_svc (FORCE RLS) + migration 0169.
 *
 * Safety property under test: the govt seed is BYTE-IDENTICAL to origin/main (fixtures/govt-standard-gl-heads.json), and
 * the template only changes when TENANT_PROFILES_ENABLED is on AND coa_template != govt.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeSettings } from "../src/modules/approvals/schema.js";
import {
  standardGlHeads, coreGlHeads, templateGlHeads, glHeadsForTemplate, seedGlHeadsTx, seedStandardGlHeadsTx,
  CoaTemplateCollisionError, STATEMENT_CLASSES, BILL_HEAD_HOA, assertNoTemplateCollision, missingAccrualStoresHeads,
} from "../src/modules/gl/standard-heads.js";
import { templateDefaultBillHead, grnBillHeadCode } from "../src/modules/gl/system-heads.js";
import { resolveCoaTemplateTx } from "../src/modules/gl/coa-template.js";
import { isNonRetryable } from "@civitasone/queue";
import postgres from "postgres";
import { backfillStandardGlHeads } from "../scripts/backfill-standard-gl-heads.js";
import { headNatureOf } from "../src/shared/head-nature.js";

const ACTOR = randomUUID();
const fixture = JSON.parse(readFileSync(new URL("./fixtures/govt-standard-gl-heads.json", import.meta.url), "utf8"));
const codes = (hs: Array<{ code: string }>) => hs.map((h) => h.code);

afterAll(async () => { await sqlClient.end(); });

describe("S4 pure: govt is byte-identical", () => {
  it("standardGlHeads() === the origin/main fixture, in order (golden)", () => {
    expect(JSON.stringify(standardGlHeads())).toBe(JSON.stringify(fixture.standard));
  });
  it("glHeadsForTemplate('govt') === standardGlHeads(); no govt row carries a statementClass", () => {
    expect(JSON.stringify(glHeadsForTemplate("govt"))).toBe(JSON.stringify(standardGlHeads()));
    expect(standardGlHeads().every((h) => !("statementClass" in h))).toBe(true);
  });
  it("govt template head = 2202 General Education with its HoA", () => {
    expect(templateGlHeads("govt")).toEqual([{ code: "2202", name: "General Education", classification: "expense", hoaCode: BILL_HEAD_HOA }]);
  });
  it("core + govt template heads cover exactly the govt list (as a set)", () => {
    expect(new Set([...codes(coreGlHeads()), ...codes(templateGlHeads("govt"))])).toEqual(new Set(codes(standardGlHeads())));
  });
  it("2202 is not a core head", () => { expect(codes(coreGlHeads())).not.toContain("2202"); });
});

describe("S4 pure: default bill head", () => {
  it("templateDefaultBillHead: govt 2202, commercial/nonprofit 5400", () => {
    expect(templateDefaultBillHead("govt")).toBe("2202");
    expect(templateDefaultBillHead("commercial")).toBe("5400");
    expect(templateDefaultBillHead("nonprofit")).toBe("5400");
  });
  it("grnBillHeadCode defaults to govt 2202 and follows the template; the env var still wins", () => {
    const saved = process.env.FINANCE_GRN_BILL_HEAD_CODE;
    delete process.env.FINANCE_GRN_BILL_HEAD_CODE;
    try {
      expect(grnBillHeadCode()).toBe("2202");
      expect(grnBillHeadCode("commercial")).toBe("5400");
      process.env.FINANCE_GRN_BILL_HEAD_CODE = "9999";
      expect(grnBillHeadCode("nonprofit")).toBe("9999");
    } finally { if (saved === undefined) delete process.env.FINANCE_GRN_BILL_HEAD_CODE; else process.env.FINANCE_GRN_BILL_HEAD_CODE = saved; }
  });
});

describe("S4 pure: commercial and nonprofit head sets", () => {
  const commercial = ["5400", "1500", "1600", "1700", "1800", "2300", "2310", "2400", "2500", "3000", "3200", "4400", "5410", "5420", "5430", "5440", "5450", "6200"];
  const nonprofit = ["5400", "1500", "1550", "2300", "2310", "3000", "3200", "4400", "4410", "4420", "5410", "5420", "5430", "5440", "6200"];
  it("commercial template heads are exactly the design list; default bill head 5400 has no HoA", () => {
    expect(codes(templateGlHeads("commercial")).sort()).toEqual([...commercial].sort());
    expect(templateGlHeads("commercial").find((h) => h.code === "5400")).toMatchObject({ name: "Purchases and Direct Expenses", classification: "expense", statementClass: "expense" });
    expect(templateGlHeads("commercial").every((h) => h.hoaCode === undefined)).toBe(true);
  });
  it("nonprofit template heads are exactly the design list", () => {
    expect(codes(templateGlHeads("nonprofit")).sort()).toEqual([...nonprofit].sort());
    expect(templateGlHeads("nonprofit").find((h) => h.code === "5400")).toMatchObject({ name: "Programme Expenses" });
  });
  it.each(["commercial", "nonprofit"] as const)("%s: no template code clashes with a core code, and the full list has unique codes", (t) => {
    const core = new Set(codes(coreGlHeads()));
    for (const c of codes(templateGlHeads(t))) expect(core.has(c)).toBe(false);
    const all = codes(glHeadsForTemplate(t));
    expect(new Set(all).size).toBe(all.length);
  });
  it.each(["commercial", "nonprofit"] as const)("%s: every head has a valid statementClass consistent with head-nature", (t) => {
    for (const h of glHeadsForTemplate(t)) {
      expect(STATEMENT_CLASSES as readonly string[]).toContain(h.statementClass);
      const nature = headNatureOf(h.code, h.classification);
      const expected = nature === "liability" ? "current_liability" : nature;
      // reserve is the equity-nature sub-class for 3200; everything else maps 1:1
      expect(h.statementClass === expected || (h.statementClass === "reserve" && nature === "equity")).toBe(true);
    }
  });
  it("specific classes: 3200 reserve, 3000 equity, 2300 current_liability, 1550 asset, 4400 income", () => {
    const by = new Map(glHeadsForTemplate("nonprofit").map((h) => [h.code, h.statementClass]));
    expect(by.get("3200")).toBe("reserve"); expect(by.get("3000")).toBe("equity"); expect(by.get("2300")).toBe("current_liability");
    expect(by.get("1550")).toBe("asset"); expect(by.get("4400")).toBe("income");
  });
  it("the PSU statement classes are in the domain", () => {
    for (const c of ["govt_equity", "capital_reserve", "dividend_payable", "asset", "current_liability", "equity", "reserve", "income", "expense"]) expect(STATEMENT_CLASSES as readonly string[]).toContain(c);
  });
  it("govt + office-pack adds 5410-5460 expense heads; without the pack nothing is added", () => {
    expect(codes(glHeadsForTemplate("govt", ["office-pack"]))).toEqual(expect.arrayContaining(["5410", "5420", "5430", "5440", "5450", "5460", "2202"]));
    expect(codes(glHeadsForTemplate("govt", []))).not.toContain("5410");
  });
});

describe("S4 pure: resolveCoaTemplateTx is govt with the flag off (no query)", () => {
  const saved = process.env.TENANT_PROFILES_ENABLED;
  afterEach(() => { if (saved === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = saved; });
  it("flag off => govt without touching the transaction", async () => {
    delete process.env.TENANT_PROFILES_ENABLED;
    const tx = new Proxy({}, { get() { throw new Error("must not query"); } });
    expect(await resolveCoaTemplateTx(tx, randomUUID())).toEqual({ template: "govt", packs: [] });
  });
});

describe("S4 real Postgres: seeding", () => {
  async function seed(t: string, template: "govt" | "commercial" | "nonprofit", packs: string[] = []) {
    return scoped(t, (tx) => seedGlHeadsTx(tx, t, template, packs, ACTOR));
  }
  const rows = (t: string) => scoped(t, (tx) => tx.select().from(financeHeads).where(eq(financeHeads.tenantId, t)));
  const project = (rs: Array<{ code: string; name: string; classification: string | null; hoaCode: string | null; isControl: boolean }>) =>
    rs.map((r) => ({ code: r.code, name: r.name, classification: r.classification, hoaCode: r.hoaCode === null ? undefined : r.hoaCode.trim(), isControl: r.isControl }))
      .sort((a, b) => a.code.localeCompare(b.code));

  it("GOLDEN: seedGlHeadsTx(govt) writes rows identical to today's standardGlHeads() (code,name,classification,hoaCode,isControl), statement_class NULL", async () => {
    const t = randomUUID();
    await seed(t, "govt");
    const got = await rows(t);
    const want = standardGlHeads().map((h) => ({ code: h.code, name: h.name, classification: h.classification, hoaCode: h.hoaCode, isControl: h.isControl ?? false }))
      .sort((a, b) => a.code.localeCompare(b.code));
    expect(project(got)).toEqual(want);
    expect(got.every((r) => r.statementClass === null)).toBe(true);
  });
  it("the back-compat seedStandardGlHeadsTx writes the same govt rows", async () => {
    const a = randomUUID(), b = randomUUID();
    await seed(a, "govt");
    await scoped(b, (tx) => seedStandardGlHeadsTx(tx, b, ACTOR));
    expect(project(await rows(b))).toEqual(project(await rows(a)));
  });
  it.each(["commercial", "nonprofit"] as const)("%s seeds core + template heads with statement_class, never touching finance_major_heads", async (tmpl) => {
    const t = randomUUID();
    const { financeMajorHeads } = await import("../src/modules/hoa/schema.js");
    const { count } = await import("drizzle-orm");
    const before = await scoped(t, (tx) => tx.select({ n: count() }).from(financeMajorHeads));
    await seed(t, tmpl);
    const got = await rows(t);
    expect(new Set(got.map((r) => r.code))).toEqual(new Set(codes(glHeadsForTemplate(tmpl))));
    expect(got.every((r) => r.statementClass !== null)).toBe(true);
    expect(got.find((r) => r.code === "5400")).toMatchObject({ statementClass: "expense", hoaCode: null });
    expect(got.find((r) => r.code === "2202")).toBeUndefined();
    expect(got.find((r) => r.code === "3200")?.statementClass).toBe("reserve");
    const after = await scoped(t, (tx) => tx.select({ n: count() }).from(financeMajorHeads));
    expect(after[0]!.n).toBe(before[0]!.n);
  });
  it("seeding is idempotent (a second run changes nothing)", async () => {
    const t = randomUUID();
    await seed(t, "commercial");
    const first = project(await rows(t));
    await seed(t, "commercial");
    expect(project(await rows(t))).toEqual(first);
  });
  it("COLLISION GUARD: a tenant already using 2300 as an expense head makes the commercial seed abort, writing nothing", async () => {
    const t = randomUUID();
    await scoped(t, (tx) => tx.insert(financeHeads).values({ tenantId: t, code: "2300", name: "Some govt expense head", level: 0, classification: "expense", createdBy: ACTOR, updatedBy: ACTOR }));
    await expect(seed(t, "commercial")).rejects.toBeInstanceOf(CoaTemplateCollisionError);
    const got = await rows(t);
    expect(got.map((r) => r.code)).toEqual(["2300"]);
    expect(got[0]!.name).toBe("Some govt expense head");
  });
  it("collision guard allows a head under the same code with the SAME classification (left untouched)", async () => {
    const t = randomUUID();
    await scoped(t, (tx) => tx.insert(financeHeads).values({ tenantId: t, code: "2300", name: "My GST", level: 0, classification: "liability", createdBy: ACTOR, updatedBy: ACTOR }));
    await seed(t, "commercial");
    expect((await rows(t)).find((r) => r.code === "2300")!.name).toBe("My GST");
  });
  it("migration 0169 CHECK refuses an unknown statement_class", async () => {
    const t = randomUUID();
    await expect(scoped(t, (tx) => tx.insert(financeHeads).values({ tenantId: t, code: "9999", name: "x", level: 0, classification: "asset", statementClass: "bogus", createdBy: ACTOR, updatedBy: ACTOR }))).rejects.toThrow();
  });
  it("resolveCoaTemplateTx: flag on + coa_template=nonprofit => nonprofit; flag on + no row => govt; flag off => govt", async () => {
    const saved = process.env.TENANT_PROFILES_ENABLED;
    try {
      const t = randomUUID(), none = randomUUID();
      await scoped(t, (tx) => tx.insert(financeSettings).values({ tenantId: t, coaTemplate: "nonprofit", updatedBy: ACTOR }));
      process.env.TENANT_PROFILES_ENABLED = "true";
      expect((await scoped(t, (tx) => resolveCoaTemplateTx(tx, t))).template).toBe("nonprofit");
      expect((await scoped(none, (tx) => resolveCoaTemplateTx(tx, none))).template).toBe("govt");
      delete process.env.TENANT_PROFILES_ENABLED;
      expect((await scoped(t, (tx) => resolveCoaTemplateTx(tx, t))).template).toBe("govt");
    } finally { if (saved === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = saved; }
  });
});

describe("S4 pure: collision guard is narrowed to template-only codes", () => {
  it("an existing CORE head (1200 asset, 4200, 1250 with NULL classification) never aborts a commercial/nonprofit seed", () => {
    for (const t of ["commercial", "nonprofit"] as const) {
      expect(() => assertNoTemplateCollision([
        { code: "1200", classification: "asset" }, { code: "1250", classification: null }, { code: "4200", classification: "income" },
      ], t)).not.toThrow();
    }
  });
  it("a genuine template-code classification mismatch aborts (and is non-retryable)", () => {
    let err: unknown;
    try { assertNoTemplateCollision([{ code: "2300", classification: "expense" }], "commercial"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CoaTemplateCollisionError);
    expect(isNonRetryable(err)).toBe(true);
    expect((err as CoaTemplateCollisionError).collisions).toEqual([{ code: "2300", existing: "expense", template: "liability" }]);
  });
  it("a template code with the SAME classification does not abort", () => {
    expect(() => assertNoTemplateCollision([{ code: "2300", classification: "liability" }], "commercial")).not.toThrow();
  });
  it("govt + 2300 expense is not checked by the pure guard for a pack-less govt list (no template-only codes)", () => {
    expect(() => assertNoTemplateCollision([{ code: "2300", classification: "expense" }], "govt")).not.toThrow();
  });
});

describe("S4 pure: accrual stores heads statement_class", () => {
  it("non-govt stamps asset / current_liability / expense; govt stays unset", () => {
    const by = (t: "govt" | "commercial" | "nonprofit") => new Map(missingAccrualStoresHeads([], t).map((h) => [h.code, h.statementClass]));
    const c = by("commercial");
    expect(c.get("1400")).toBe("asset"); expect(c.get("2080")).toBe("current_liability");
    expect(c.get("2085")).toBe("current_liability"); expect(c.get("5300")).toBe("expense");
    expect([...by("nonprofit").values()].every((v) => v !== undefined)).toBe(true);
    expect([...by("govt").values()].every((v) => v === undefined)).toBe(true);
    expect(missingAccrualStoresHeads([], "govt").every((h) => !("statementClass" in h))).toBe(true);
  });
});

describe("S4 real Postgres: non-govt backfill", () => {
  const pg = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  const saved = process.env.TENANT_PROFILES_ENABLED;
  afterAll(async () => { await pg.end({ timeout: 5 }); });
  afterEach(() => { if (saved === undefined) delete process.env.TENANT_PROFILES_ENABLED; else process.env.TENANT_PROFILES_ENABLED = saved; });
  const rows = (t: string) => scoped(t, (tx) => tx.select().from(financeHeads).where(eq(financeHeads.tenantId, t)));
  async function makeTenant(coa: "commercial" | "nonprofit", basis: "cash" | "accrual") {
    const t = randomUUID();
    await scoped(t, (tx) => tx.insert(financeSettings).values({ tenantId: t, coaTemplate: coa, accountingBasis: basis, updatedBy: ACTOR }));
    // the backfill discovers an existing tenant through its heads: give it one core head
    await scoped(t, (tx) => tx.insert(financeHeads).values({ tenantId: t, code: "1100", name: "Cash / Bank", level: 0, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR }));
    return t;
  }
  it("flag on: backfills a commercial accrual tenant from its template, statement_class stamped incl. stores heads", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    const t = await makeTenant("commercial", "accrual");
    await backfillStandardGlHeads(pg as never, { dryRun: false, tenants: [t] });
    const got = await rows(t);
    const have = new Map(got.map((r) => [r.code, r]));
    for (const h of glHeadsForTemplate("commercial")) expect(have.has(h.code)).toBe(true);
    expect(have.get("5400")?.statementClass).toBe("expense");
    expect(have.get("3200")?.statementClass).toBe("reserve");
    expect(have.get("2202")).toBeUndefined();
    expect(have.get("1400")?.statementClass).toBe("asset");
    expect(have.get("2080")?.statementClass).toBe("current_liability");
    expect(have.get("1100")?.statementClass).toBeNull(); // existing head untouched
  });
  it("flag on: a real template-code classification mismatch fails loudly and writes nothing", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    const t = await makeTenant("nonprofit", "cash");
    await scoped(t, (tx) => tx.insert(financeHeads).values({ tenantId: t, code: "3000", name: "Old liability", level: 0, classification: "liability", createdBy: ACTOR, updatedBy: ACTOR }));
    await expect(backfillStandardGlHeads(pg as never, { dryRun: false, tenants: [t] })).rejects.toBeInstanceOf(CoaTemplateCollisionError);
    expect((await rows(t)).map((r) => r.code).sort()).toEqual(["1100", "3000"]);
  });
  it("flag on: an existing core head at another classification does NOT abort the backfill", async () => {
    process.env.TENANT_PROFILES_ENABLED = "true";
    const t = await makeTenant("commercial", "cash");
    await scoped(t, (tx) => tx.insert(financeHeads).values({ tenantId: t, code: "1200", name: "Fixed Assets", level: 0, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR }));
    await expect(backfillStandardGlHeads(pg as never, { dryRun: false, tenants: [t] })).resolves.toBeDefined();
  });
  it("flag off: the tenant is backfilled with the govt list (2202, no statement_class) whatever its coa_template", async () => {
    delete process.env.TENANT_PROFILES_ENABLED;
    const t = await makeTenant("commercial", "cash");
    await backfillStandardGlHeads(pg as never, { dryRun: false, tenants: [t] });
    const got = await rows(t);
    expect(got.find((r) => r.code === "2202")).toBeDefined();
    expect(got.find((r) => r.code === "5400")).toBeUndefined();
    expect(got.every((r) => r.statementClass === null)).toBe(true);
  });
});
