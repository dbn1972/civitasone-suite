import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const loaderMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getFinanceGuarantees: () => loaderMock() }));
vi.mock("./GuaranteesTable", () => ({ GuaranteesTable: () => <div>guarantees-table</div> }));

import GuaranteesPage from "./page";

describe("GuaranteesPage", () => {
  // GAP-FINANCE-EXPENDITURE-GUARANTEES-04: the register is read-only; point at the real entry point.
  it("links to the Procurement EMD / BG screen where these instruments are managed", async () => {
    loaderMock.mockResolvedValue({ data: [], source: "api" });
    render(await GuaranteesPage());
    expect(screen.getByRole("link", { name: /EMD & bank guarantees/i })).toHaveAttribute("href", "/procurement/emd-bg");
  });

  // GAP-FINANCE-EXPENDITURE-GUARANTEES-03 (fixed in #1786): regression guard.
  it("a failed load shows dashes and no table, never four zeros", async () => {
    loaderMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await GuaranteesPage());
    expect(screen.queryByText("guarantees-table")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });
});
