import { describe, it, expect } from "vitest";
import { vendorStats, gstinCell } from "./vendorStats";

describe("vendorStats (GAP-FINANCE-VENDORS-03 / -05)", () => {
  it("tolerates a null status / category and counts them as neither active nor a category", () => {
    const s = vendorStats([
      { status: null, category: null },
      { status: "active", category: "Supplier" },
      { status: undefined, category: undefined },
    ]);
    expect(s).toEqual({ total: 3, active: 1, pending: 0, categories: 1 });
  });

  it("counts pending vendors separately from active ones (GAP-FINANCE-VENDORS-01)", () => {
    const s = vendorStats([{ status: "pending" }, { status: " Pending " }, { status: "active" }, { status: "inactive" }, { status: "rejected" }]);
    expect(s).toMatchObject({ total: 5, active: 1, pending: 2 });
  });

  it("counts 'Supplier' and ' supplier ' as one category", () => {
    expect(vendorStats([{ category: "Supplier" }, { category: " supplier " }, { category: "Services" }]).categories).toBe(2);
  });
});

describe("gstinCell (GAP-FINANCE-VENDORS-04)", () => {
  it("labels a missing GSTIN as Unregistered and leaves a real one alone", () => {
    expect(gstinCell(null)).toBe("Unregistered");
    expect(gstinCell("")).toBe("Unregistered");
    expect(gstinCell("  ")).toBe("Unregistered");
    expect(gstinCell("29ABCDE1234F1Z5")).toBe("29ABCDE1234F1Z5");
  });
});
