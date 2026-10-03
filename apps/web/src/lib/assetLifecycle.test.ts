import { describe, it, expect } from "vitest";
import { assetActionScope, deriveLifecycle, hasAmcRecord, isTerminalAsset } from "./assetLifecycle";

const base = { purchaseDate: "2024-04-01", maintenanceHistory: [], formatDate: (d: string) => `<${d}>` };

describe("assetActionScope / isTerminalAsset (GAP-ASSETS-DETAIL-05)", () => {
  it("treats disposed and written_off as terminal with no actions", () => {
    for (const s of ["disposed", "written_off"]) {
      expect(isTerminalAsset(s)).toBe(true);
      expect(assetActionScope(s)).toBe("none");
    }
  });

  it("condemned allows tagging only (the auction workflow owns disposal)", () => {
    expect(isTerminalAsset("condemned")).toBe(false);
    expect(assetActionScope("condemned")).toBe("tag-only");
  });

  it("every other status gets the full action set", () => {
    for (const s of ["active", "in_use", "maintenance", "transferred"]) expect(assetActionScope(s)).toBe("full");
  });
});

describe("lost / scrapped (GAP-ASSETS-LIST-04)", () => {
  it("scrapped is terminal; lost allows tagging only until it is found or written off", () => {
    expect(isTerminalAsset("scrapped")).toBe(true);
    expect(assetActionScope("scrapped")).toBe("none");
    expect(isTerminalAsset("lost")).toBe(false);
    expect(assetActionScope("lost")).toBe("tag-only");
    expect(assetActionScope("unknown")).toBe("full");
  });
});

describe("deriveLifecycle (GAP-ASSETS-DETAIL-08)", () => {
  const step = (steps: ReturnType<typeof deriveLifecycle>, label: string) => steps.find((s) => s.label === label)!;

  it("Tagged is todo without a barcode and done with one", () => {
    expect(step(deriveLifecycle({ ...base, status: "active" }), "Tagged").state).toBe("todo");
    expect(step(deriveLifecycle({ ...base, status: "active", barcode: "AST-1" }), "Tagged").state).toBe("done");
  });

  it("a warranty alone is not an AMC; it is shown separately", () => {
    const steps = deriveLifecycle({ ...base, status: "active", warrantyExpiry: "2027-01-01" });
    expect(step(steps, "AMC").state).toBe("todo");
    expect(step(steps, "AMC").detail).toBe("Warranty until <2027-01-01>");
  });

  it("an AMC maintenance record marks the AMC step done", () => {
    expect(hasAmcRecord([{ type: "annual", description: "AMC plan" }])).toBe(true);
    expect(hasAmcRecord([{ type: "repair", description: "fan replaced" }])).toBe(false);
    const steps = deriveLifecycle({ ...base, status: "active", maintenanceHistory: [{ type: "annual", description: "AMC plan" }] });
    expect(step(steps, "AMC").state).toBe("done");
  });

  it("an asset under maintenance still has a current step", () => {
    const steps = deriveLifecycle({ ...base, status: "maintenance" });
    expect(step(steps, "In use").state).toBe("cur");
    expect(step(steps, "In use").detail).toBe("Under maintenance");
  });

  it("disposed and condemned assets read correctly at the Disposal step", () => {
    expect(step(deriveLifecycle({ ...base, status: "disposed" }), "Disposal").state).toBe("done");
    const c = deriveLifecycle({ ...base, status: "condemned" });
    expect(step(c, "Disposal").state).toBe("cur");
    expect(step(c, "Disposal").detail).toMatch(/awaiting auction/);
  });
});
