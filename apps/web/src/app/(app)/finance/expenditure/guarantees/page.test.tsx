import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const loaderMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getFinanceGuarantees: () => loaderMock() }));
vi.mock("./GuaranteesTable", () => ({ GuaranteesTable: () => <div>guarantees-table</div> }));

import GuaranteesPage from "./page";

describe("GuaranteesPage", () => {
  // GAP-FINANCE-EXPENDITURE-GUARANTEES-04: the register is read-only; the link goes to the Procurement register (a route
  // that exists), worded as that separate register rather than as where these guarantees are managed.
  it("links to the separate Procurement EMD / BG register", async () => {
    loaderMock.mockResolvedValue({ data: [], source: "api" });
    render(await GuaranteesPage());
    const link = screen.getByRole("link", { name: /EMD & bank guarantees register \(Procurement\)/i });
    expect(link).toHaveAttribute("href", "/procurement/emd-bg");
  });

  // GAP-FINANCE-EXPENDITURE-GUARANTEES-03 (fixed in #1786): regression guard.
  it("a failed load shows dashes and no table, never four zeros", async () => {
    loaderMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await GuaranteesPage());
    expect(screen.queryByText("guarantees-table")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  // GAP2-FINANCE-GUARANTEES-COPY-08: the copy must make the read-only nature unambiguous and not imply any action here.
  // GAP-FINANCE-EXPENDITURE-GUARANTEES-04: it must also not claim the rows are a mirror of Procurement's register -- the only
  // writer of finance_guarantees is finance-service's own create command, nothing is copied in from Procurement.
  it("states the register is read-only and does not claim to mirror Procurement", async () => {
    loaderMock.mockResolvedValue({ data: [], source: "api" });
    const { container } = render(await GuaranteesPage());
    expect(screen.getByText(/cannot be recorded, released or invoked from this screen yet/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/mirror/i);
    expect(container.textContent).not.toMatch(/Procurement-managed/i);
    // The old subtitle "Bank guarantees, performance securities, and earnest money deposits." is gone.
    expect(screen.queryByText("Bank guarantees, performance securities, and earnest money deposits.")).not.toBeInTheDocument();
  });
});
