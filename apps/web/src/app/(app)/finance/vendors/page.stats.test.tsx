import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const getFinanceVendors = vi.hoisted(() => vi.fn());
vi.mock("@/app/_data/loaders", () => ({ getFinanceVendors: (...a: unknown[]) => getFinanceVendors(...a) }));
vi.mock("./VendorsTable", () => ({ VendorsTable: () => <div>vendors-table</div> }));

import VendorsPage from "./page";

describe("VendorsPage cards (GAP-FINANCE-VENDORS-03 / -05)", () => {
  it("renders without throwing when a row has a null status, and counts the category once", async () => {
    getFinanceVendors.mockResolvedValue({
      data: [
        { id: "a", name: "A", category: "Supplier", pan: null, gstin: null, status: null, ratingDisplay: "x" },
        { id: "b", name: "B", category: "supplier", pan: null, gstin: null, status: "active", ratingDisplay: "x" },
      ],
      source: "api",
    });
    render(await VendorsPage());
    const cat = screen.getByText("Categories").closest(".stat");
    expect(cat).toHaveTextContent("1");
    const active = screen.getByText("Active").closest(".stat");
    expect(active).toHaveTextContent("1");
  });
});
