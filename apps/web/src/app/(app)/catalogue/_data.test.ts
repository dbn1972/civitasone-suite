import { describe, it, expect } from "vitest";
import { mapRows, flattenCategoryTree, mapRateRows, isRateInForce, mapBundleRows } from "./_data";

describe("mapRows — catalogue generic mapper", () => {
  // GAP-CATALOGUE-{CATEGORIES,PRODUCTS,RATES,BUNDLES}-02/03 (WIRING): an
  // unexpected, non-list 200 body must become source:"error" (mapRows -> null),
  // not a single junk row.
  it("returns null for a non-list object payload (WIRING)", () => {
    expect(mapRows({ message: "ok" })).toBeNull();
    expect(mapRows({ status: "ok" })).toBeNull();
  });

  it("returns null for a scalar/invalid payload (WIRING)", () => {
    expect(mapRows("x")).toBeNull();
    expect(mapRows(42)).toBeNull();
    expect(mapRows(null)).toBeNull();
  });

  it("maps an array payload and a { data: [...] } envelope", () => {
    expect(mapRows([{ id: "p-1", name: "Savings" }])).toEqual([
      { id: "p-1", label: "Savings" },
    ]);
    const rows = mapRows({ data: [{ id: "p-1", name: "Savings" }] });
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ id: "p-1", label: "Savings" });
  });

  // GAP-CATALOGUE-{CATEGORIES,PRODUCTS,RATES,BUNDLES}-03/04 (DUPLICATE-COLUMN):
  // Detail must NOT echo the Status when a row has only a status.
  it("does not duplicate status into the Detail/sublabel column (DUPLICATE-COLUMN)", () => {
    const rows = mapRows([{ name: "A", status: "ACTIVE" }])!;
    expect(rows[0]!.status).toBe("ACTIVE");
    expect(rows[0]!.sublabel).toBeUndefined();
  });

  it("still uses description/category/tier for Detail", () => {
    expect(mapRows([{ name: "A", status: "ACTIVE", category: "Loans" }])![0]).toMatchObject({
      status: "ACTIVE",
      sublabel: "Loans",
    });
    expect(mapRows([{ name: "A", description: "A savings product" }])![0]!.sublabel).toBe(
      "A savings product",
    );
  });

  // GAP-CATALOGUE-{BUNDLES,CATEGORIES,PRODUCTS,RATES}-04/05 (ID-TRUNCATION):
  // a code-only row keeps its full code as id AND as a distinct `code` field.
  it("keeps a human code intact as id and code (ID-TRUNCATION)", () => {
    const row = mapRows([{ code: "SVC-BPA-01", name: "BPA service" }])![0]!;
    expect(row.id).toBe("SVC-BPA-01");
    expect(row.code).toBe("SVC-BPA-01");
    expect(row.id).not.toBe("SVC-BPA-"); // not truncated by the mapper
  });

  it("reads a product's lifecycleStatus and productCode", () => {
    const row = mapRows([
      { id: "11111111-1111-4111-8111-111111111111", name: "Term Deposit", lifecycleStatus: "active", productCode: "TD-01", category: "Deposits" },
    ])![0]!;
    expect(row.status).toBe("active");
    expect(row.code).toBe("TD-01");
    expect(row.sublabel).toBe("Deposits");
  });
});

describe("flattenCategoryTree — GAP-CATALOGUE-CATEGORIES-01 (TREE)", () => {
  it("flattens a 3-level tree into 3 rows in depth order with increasing depth", () => {
    const tree = {
      data: [
        {
          id: "root",
          name: "Banking",
          level: "line",
          children: [
            {
              id: "child",
              name: "Savings",
              level: "family",
              children: [{ id: "grand", name: "Youth Savings", level: "product", children: [] }],
            },
          ],
        },
      ],
    };
    const rows = flattenCategoryTree(tree)!;
    expect(rows.map((r) => r.label)).toEqual(["Banking", "Savings", "Youth Savings"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2]);
    expect(rows[1]!.parentLabel).toBe("Banking");
    expect(rows[2]!.parentLabel).toBe("Savings");
  });

  it("renders a childless root as a single depth-0 row", () => {
    const rows = flattenCategoryTree([{ id: "r", name: "Solo", children: [] }])!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Solo", depth: 0 });
  });

  it("returns null for a non-list payload (WIRING)", () => {
    expect(flattenCategoryTree({ message: "nope" })).toBeNull();
  });
});

describe("mapRateRows / isRateInForce — GAP-CATALOGUE-RATES-01 (MISSING-FIELDS)", () => {
  it("formats the paise amount with the rupee symbol", () => {
    const row = mapRateRows([
      { id: "r-1", rateValueMinor: "12550", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", source: "manual" },
    ])![0]!;
    expect(row.label).toBe("₹125.50");
    expect(row.meta).toBe("manual");
  });

  it("renders the money amount from the serialized DB field rateValue (GAP2-CATALOGUE-RATES-02)", () => {
    // GET /v1/catalogue/rates returns raw Drizzle rows whose money column is
    // `rateValue` (minor units/paise bigint) — the mapper must read it, not
    // only the event-contract alias `rateValueMinor`.
    const row = mapRateRows([{ id: "r-2", rateValue: "12550", effectiveDate: "2026-01-01" }])![0]!;
    expect(row.label).toBe("₹125.50");
  });

  it("rejects a negative or non-integer serialized rateValue (strict minor-unit money)", () => {
    for (const bad of ["-12550", "125.50", "1e3", " 12550", ""]) {
      const row = mapRateRows([{ id: "r-bad", rateValue: bad, effectiveDate: "2026-01-01" }])![0]!;
      expect(row.label).toBe("—");
    }
  });

  it("orders cards newest effective-from first, undated last", () => {
    const rows = mapRateRows([
      { id: "old", rateValueMinor: "100", effectiveFrom: "2025-01-01" },
      { id: "none", rateValueMinor: "100" },
      { id: "new", rateValueMinor: "100", effectiveFrom: "2026-03-01" },
    ])!;
    expect(rows.map((r) => r.id)).toEqual(["new", "old", "none"]);
  });

  it("marks the card containing today as In force and others as not", () => {
    expect(isRateInForce("2026-01-01", "2026-12-31", "2026-06-15")).toBe(true);
    expect(isRateInForce("2026-01-01", "2026-12-31", "2027-01-01")).toBe(false);
    expect(isRateInForce("2026-06-01", null, "2026-06-15")).toBe(true); // open-ended
    expect(isRateInForce("2026-06-01", null, "2026-05-01")).toBe(false); // not started
  });

  it("returns null for a non-list rates payload (WIRING)", () => {
    expect(mapRateRows({ error: "boom" })).toBeNull();
  });

  it("shows — for a rate with no amount rather than a fabricated ₹0", () => {
    const row = mapRateRows([{ id: "r-3", effectiveFrom: "2026-01-01" }])![0]!;
    expect(row.label).toBe("—");
  });
});

describe("mapBundleRows — GAP-CATALOGUE-BUNDLES-01 (members)", () => {
  it("shows the member count from componentProductIds", () => {
    const row = mapBundleRows([
      { id: "b-1", name: "Starter combo", description: "Three services", componentProductIds: ["p1", "p2", "p3"], status: "active" },
    ])![0]!;
    expect(row.meta).toBe("3 members");
    expect(row.sublabel).toBe("Three services");
    expect(row.status).toBe("active");
  });

  it("uses the singular for a one-member bundle", () => {
    expect(mapBundleRows([{ id: "b-2", name: "Solo", componentProductIds: ["p1"] }])![0]!.meta).toBe("1 member");
  });

  it("returns null for a non-list bundle payload (WIRING)", () => {
    expect(mapBundleRows({ message: "x" })).toBeNull();
  });
});
