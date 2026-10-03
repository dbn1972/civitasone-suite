import { describe, it, expect } from "vitest";
import { isValidRegistration, normaliseRegistration, parseRegistration } from "./registration";
import { fuelLabel, FUEL_LABELS } from "./labels";
import { displayStatus } from "./maintenanceStatus";

describe("registration number (GAP-ASSETS-FLEET-VEHICLES-05)", () => {
  it("normalises case, spaces and hyphens", () => {
    expect(normaliseRegistration(" od-02 ab 1234 ")).toBe("OD02AB1234");
  });
  it("accepts standard and BH-series plates", () => {
    for (const ok of ["OD02AB1234", "DL1CAB1234", "DL-01-AB-1234", "MH12DE1433", "22BH1234AA", "KA011234"]) {
      expect(isValidRegistration(ok), ok).toBe(true);
    }
  });
  it("rejects obviously malformed values", () => {
    for (const bad of ["abc", "1234", "OD02AB12", "OD02AB12345", "ZZZZZZZZZZ"]) {
      expect(isValidRegistration(bad), bad).toBe(false);
    }
  });
  it("parseRegistration returns the normalised value or a message", () => {
    expect(parseRegistration("od 02 ab 1234")).toEqual({ ok: true, value: "OD02AB1234" });
    expect(parseRegistration("")).toEqual({ ok: false, error: "Registration number is required." });
    const bad = parseRegistration("abc");
    expect(bad.ok).toBe(false);
  });
});

describe("fuel labels (GAP-ASSETS-FLEET-VEHICLES-04)", () => {
  it("renders CNG, not Cng", () => {
    expect(FUEL_LABELS.cng).toBe("CNG");
    expect(fuelLabel("cng")).toBe("CNG");
    expect(fuelLabel("petrol")).toBe("Petrol");
    expect(fuelLabel("hydrogen")).toBe("hydrogen");
    expect(fuelLabel("")).toBe("—");
  });
});

describe("displayStatus (GAP-ASSETS-FLEET-MAINTENANCE-05)", () => {
  it("derives overdue only for a past-dated scheduled job", () => {
    expect(displayStatus("scheduled", "2020-01-01")).toBe("overdue");
    expect(displayStatus("scheduled", "2099-01-01")).toBe("scheduled");
    expect(displayStatus("completed", "2020-01-01")).toBe("completed");
    expect(displayStatus("cancelled", "2020-01-01")).toBe("cancelled");
    expect(displayStatus("scheduled", "")).toBe("scheduled");
  });
});
