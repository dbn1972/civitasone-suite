import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const products = vi.fn();
const ratesFor = vi.fn();
vi.mock("../_data", () => ({
  getCatalogueProducts: () => products(),
  getCatalogueRatesForProduct: (id: string) => ratesFor(id),
}));
vi.mock("../../../_components/ModuleListPage", () => ({
  ModuleListPage: (p: { description: string; rows: Array<{ id: string; label: string }>; children?: React.ReactNode }) => (
    <div>
      <p>{p.description}</p>
      {p.children}
      <ul>{p.rows.map((r) => <li key={r.id}>{r.label}</li>)}</ul>
    </div>
  ),
}));

import Page from "./page";

const PID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  products.mockReset().mockResolvedValue({ data: [{ id: PID, label: "Birth certificate" }], source: "api" });
  ratesFor.mockReset().mockResolvedValue({ data: [{ id: "r1", label: "₹125.50" }], source: "api" });
});

describe("Catalogue rates page (GAP-CATALOGUE-RATES-01)", () => {
  it("offers a product picker and makes no rates call until one is chosen", async () => {
    render(await Page({}));
    expect(screen.getByRole("combobox", { name: /product/i })).toBeInTheDocument();
    expect(screen.getByText(/choose a product/i)).toBeInTheDocument();
    expect(ratesFor).not.toHaveBeenCalled();
  });

  it("lists the selected product's rate cards", async () => {
    render(await Page({ searchParams: { productId: PID } }));
    expect(ratesFor).toHaveBeenCalledWith(PID);
    expect(screen.getByText("₹125.50")).toBeInTheDocument();
  });

  it("rejects a malformed product id without calling the API", async () => {
    render(await Page({ searchParams: { productId: "not-a-uuid" } }));
    expect(ratesFor).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/not valid/i);
  });
});
