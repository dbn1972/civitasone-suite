import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const rolesMock = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));
const loaderMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({ getFinanceAdvances: () => loaderMock() }));
vi.mock("./AdvancesTable", () => ({ AdvancesTable: () => <div>advances-table</div> }));

import AdvancesPage from "./page";

describe("AdvancesPage", () => {
  beforeEach(() => {
    rolesMock.mockReset();
    loaderMock.mockResolvedValue({ data: [], source: "api" });
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-04: the button prints the register; it must not claim to be an ageing report.
  it("labels the print action honestly", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    render(await AdvancesPage());
    expect(screen.queryByRole("button", { name: /ageing/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /print register/i })).toBeInTheDocument();
  });

  // GAP-FINANCE-EXPENDITURE-BILLS-05 (same server guard on POST /v1/finance/advances)
  it("hides + New Advance from read-only readers", async () => {
    rolesMock.mockReturnValue(["procurement_officer"]);
    render(await AdvancesPage());
    expect(screen.queryByRole("link", { name: /new advance/i })).not.toBeInTheDocument();
    rolesMock.mockReturnValue(["finance_officer"]);
  });

  it("offers + New Advance to finance_officer", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    render(await AdvancesPage());
    expect(screen.getByRole("link", { name: /new advance/i })).toBeInTheDocument();
  });
});
