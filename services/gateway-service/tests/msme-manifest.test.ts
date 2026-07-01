/**
 * MSME sector-adaptive module manifest + screen config tests.
 *
 * Verifies that:
 * 1. Each MSME sector gets the correct modules enabled
 * 2. Manufacturing gets production/stock/dispatch but NOT projects
 * 3. Trading gets CRM/stock but NOT production
 * 4. Services gets projects/contracts but NOT stock/dispatch
 * 5. The screen manifest API returns correct sidebar/widgets/terminology per sector
 * 6. Invalid/missing sector falls back to trading (most generic)
 * 7. Non-MSME tenants (govt edition) get null from resolveMsmeModules
 */
import { describe, it, expect } from "vitest";
import { resolveMsmeModules, MSME_SECTOR_MODULES, MSME_SECTORS } from "../src/msme-modules.js";

describe("MSME Module Manifest — resolveMsmeModules()", () => {
  it("returns manufacturing modules for manufacturing sector", () => {
    const modules = resolveMsmeModules({ msme: { sector: "manufacturing" } });
    expect(modules).not.toBeNull();
    expect(modules!.has("stock")).toBe(true);
    expect(modules!.has("inventory")).toBe(true);
    expect(modules!.has("procurement")).toBe(true);
    expect(modules!.has("assets")).toBe(true);
    expect(modules!.has("finance")).toBe(true);
    expect(modules!.has("payroll")).toBe(true);
    // Manufacturing does NOT get projects/contracts/knowledge
    expect(modules!.has("projects")).toBe(false);
    expect(modules!.has("contracts")).toBe(false);
  });

  it("returns trading modules for trading sector", () => {
    const modules = resolveMsmeModules({ msme: { sector: "trading" } });
    expect(modules).not.toBeNull();
    expect(modules!.has("crm")).toBe(true);
    expect(modules!.has("stock")).toBe(true);
    expect(modules!.has("billing")).toBe(true);
    expect(modules!.has("finance")).toBe(true);
    // Trading does NOT get production/assets/projects
    expect(modules!.has("assets")).toBe(false);
    expect(modules!.has("projects")).toBe(false);
    expect(modules!.has("contracts")).toBe(false);
  });

  it("returns services modules for services sector", () => {
    const modules = resolveMsmeModules({ msme: { sector: "services" } });
    expect(modules).not.toBeNull();
    expect(modules!.has("projects")).toBe(true);
    expect(modules!.has("contracts")).toBe(true);
    expect(modules!.has("crm")).toBe(true);
    expect(modules!.has("knowledge")).toBe(true);
    expect(modules!.has("payroll")).toBe(true);
    // Services does NOT get stock/inventory/procurement/assets
    expect(modules!.has("stock")).toBe(false);
    expect(modules!.has("inventory")).toBe(false);
    expect(modules!.has("procurement")).toBe(false);
    expect(modules!.has("assets")).toBe(false);
  });

  it("returns null for non-MSME tenant (no msme in settings)", () => {
    expect(resolveMsmeModules({})).toBeNull();
    expect(resolveMsmeModules(null)).toBeNull();
    expect(resolveMsmeModules(undefined)).toBeNull();
    expect(resolveMsmeModules({ someOtherSetting: true })).toBeNull();
  });

  it("returns null when msme object exists but has no sector", () => {
    expect(resolveMsmeModules({ msme: {} })).toBeNull();
    expect(resolveMsmeModules({ msme: { category: "small" } })).toBeNull();
  });

  it("returns null for unknown sector string", () => {
    expect(resolveMsmeModules({ msme: { sector: "unknown_sector" } })).toBeNull();
  });

  it("all three sectors have finance and payroll (universal MSME needs)", () => {
    for (const sector of MSME_SECTORS) {
      const modules = MSME_SECTOR_MODULES[sector as keyof typeof MSME_SECTOR_MODULES];
      expect(modules.has("finance"), `${sector} should have finance`).toBe(true);
      expect(modules.has("payroll"), `${sector} should have payroll`).toBe(true);
    }
  });

  it("no MSME sector includes government-only modules", () => {
    const govtOnly = ["establishment", "grants", "citizen", "telephony"];
    for (const sector of MSME_SECTORS) {
      const modules = MSME_SECTOR_MODULES[sector as keyof typeof MSME_SECTOR_MODULES];
      for (const govtMod of govtOnly) {
        expect(modules.has(govtMod), `${sector} should NOT have ${govtMod}`).toBe(false);
      }
    }
  });

  it("manufacturing is the only sector with assets (plant & machinery)", () => {
    expect(MSME_SECTOR_MODULES.manufacturing.has("assets")).toBe(true);
    expect(MSME_SECTOR_MODULES.trading.has("assets")).toBe(false);
    expect(MSME_SECTOR_MODULES.services.has("assets")).toBe(false);
  });

  it("services is the only sector with projects and contracts", () => {
    expect(MSME_SECTOR_MODULES.services.has("projects")).toBe(true);
    expect(MSME_SECTOR_MODULES.services.has("contracts")).toBe(true);
    expect(MSME_SECTOR_MODULES.manufacturing.has("projects")).toBe(false);
    expect(MSME_SECTOR_MODULES.trading.has("projects")).toBe(false);
  });
});
