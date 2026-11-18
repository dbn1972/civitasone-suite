/**
 * MSME commercial M0 (docs/design/MSME-COMMERCIAL.md section 10): gl.finance_settings gst_registered / gstin / gst_effective_from /
 * entity_type (migration 0173). Real Postgres for the column/CHECK cases; pure for the maker-checker rules.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { loadSettingsTx } from "../src/modules/approvals/repo.js";
import { financeSettings } from "../src/modules/approvals/schema.js";
import { SETTINGS_DEFAULTS, isRelaxingControl, assertGstSettingsValid, toEntityType, ENTITY_TYPES } from "../src/modules/approvals/domain.js";

const ACTOR = "00000000-cccc-4000-8000-00000000f0a1";
const GSTIN = "27AAPFU0939F1ZV";
afterAll(async () => { await sqlClient.end(); });

const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? r : (r as { rows: Record<string, unknown>[] }).rows);

describe("migration 0173: columns", () => {
  it("adds the four columns with the specified types, nullability and defaults", async () => {
    const r = rowsOf(await sqlClient`SELECT column_name, data_type, is_nullable, column_default, character_maximum_length FROM information_schema.columns
      WHERE table_schema = 'gl' AND table_name = 'finance_settings' AND column_name IN ('gst_registered','gstin','gst_effective_from','entity_type')`);
    const by = Object.fromEntries(r.map((x) => [x.column_name as string, x]));
    expect(by.gst_registered).toMatchObject({ data_type: "boolean", is_nullable: "NO" });
    expect(String(by.gst_registered?.column_default)).toMatch(/false/);
    expect(by.gstin).toMatchObject({ data_type: "character varying", is_nullable: "YES", character_maximum_length: 15 });
    expect(by.gst_effective_from).toMatchObject({ data_type: "date", is_nullable: "YES" });
    expect(by.entity_type).toMatchObject({ data_type: "text", is_nullable: "YES" });
  });

  it("a settings row inserted without them reads as not registered, and loadSettingsTx exposes the defaults", async () => {
    const t = randomUUID();
    await scoped(t, (tx) => tx.insert(financeSettings).values({ tenantId: t, updatedBy: ACTOR }));
    const s = await scoped(t, (tx) => loadSettingsTx(tx, t));
    expect(s).toMatchObject({ gstRegistered: false, gstin: null, gstEffectiveFrom: null, entityType: null });
    expect(await scoped(randomUUID(), async (tx) => { const x = await loadSettingsTx(tx, randomUUID()); return x.gstRegistered; })).toBe(false);
  });

  it("CHECK: gst_registered needs a well-formed GSTIN; a malformed one or none is refused", async () => {
    const mk = (over: Record<string, unknown>) => { const t = randomUUID(); return scoped(t, (tx) => tx.insert(financeSettings).values({ tenantId: t, updatedBy: ACTOR, ...over })); };
    await expect(mk({ gstRegistered: true })).rejects.toThrow();
    await expect(mk({ gstRegistered: true, gstin: "NOT-A-GSTIN" })).rejects.toThrow();
    await expect(mk({ gstRegistered: true, gstin: "27aapfu0939f1zv" })).rejects.toThrow();
    await mk({ gstRegistered: true, gstin: GSTIN, gstEffectiveFrom: "2026-04-01", entityType: "llp" });
    await mk({ gstRegistered: false, gstin: null });
  });

  it("CHECK: entity_type is one of the four, or NULL", async () => {
    const mk = (entityType: string | null) => { const t = randomUUID(); return scoped(t, (tx) => tx.insert(financeSettings).values({ tenantId: t, updatedBy: ACTOR, entityType })); };
    for (const e of ENTITY_TYPES) await mk(e);
    await mk(null);
    await expect(mk("trust")).rejects.toThrow();
  });

  it("both constraints are validated (not left NOT VALID)", async () => {
    const r = rowsOf(await sqlClient`SELECT conname, convalidated FROM pg_constraint
      WHERE conrelid = 'gl.finance_settings'::regclass AND conname IN ('finance_settings_gstin_when_registered','finance_settings_entity_type_valid')`);
    expect(r.length).toBe(2);
    expect(r.every((x) => x.convalidated === true)).toBe(true);
  });
});

describe("maker-checker rules for the GST settings", () => {
  it("defaults are off / null", () => {
    expect(SETTINGS_DEFAULTS).toMatchObject({ gstRegistered: false, gstin: null, gstEffectiveFrom: null, entityType: null });
  });
  it("changing any of the four is a second-admin change; an unchanged value is not", () => {
    expect(isRelaxingControl(SETTINGS_DEFAULTS, { gstRegistered: true })).toBe(true);
    expect(isRelaxingControl(SETTINGS_DEFAULTS, { gstin: GSTIN })).toBe(true);
    expect(isRelaxingControl(SETTINGS_DEFAULTS, { gstEffectiveFrom: "2026-04-01" })).toBe(true);
    expect(isRelaxingControl(SETTINGS_DEFAULTS, { entityType: "company" })).toBe(true);
    expect(isRelaxingControl(SETTINGS_DEFAULTS, { gstRegistered: false, gstin: null, entityType: null })).toBe(false);
    expect(isRelaxingControl({ ...SETTINGS_DEFAULTS, entityType: "llp" }, { entityType: "llp" })).toBe(false);
  });
  it("assertGstSettingsValid mirrors the DB CHECK", () => {
    expect(() => assertGstSettingsValid({ gstRegistered: false, gstin: null })).not.toThrow();
    expect(() => assertGstSettingsValid({ gstRegistered: true, gstin: GSTIN })).not.toThrow();
    expect(() => assertGstSettingsValid({ gstRegistered: true, gstin: null })).toThrow(/GSTIN/);
    expect(() => assertGstSettingsValid({ gstRegistered: true, gstin: "123" })).toThrow(/GSTIN/);
  });
  it("toEntityType coerces unknowns to null", () => {
    expect(toEntityType("company")).toBe("company");
    expect(toEntityType("trust")).toBeNull();
    expect(toEntityType(undefined)).toBeNull();
  });
});

describe("the settings route stays maker-checker only and does not expose coa_template / profile_code", () => {
  it("routes.ts body schema has the four fields but not coaTemplate / profileCode", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/modules/approvals/routes.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("const settingsBody"), src.indexOf("function view"));
    for (const k of ["gstRegistered", "gstin", "gstEffectiveFrom", "entityType"]) expect(body).toContain(k + ":");
    expect(body).not.toMatch(/coaTemplate:|profileCode:/);
  });
  it("every GST change is routed through settings_relax (alwaysDistinctApprover)", async () => {
    const { alwaysDistinctApprover } = await import("../src/modules/approvals/domain.js");
    expect(alwaysDistinctApprover("settings_relax")).toBe(true);
    void sql;
  });
});
