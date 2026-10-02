import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getById = vi.fn();
vi.mock("../../../../../_data/loaders", () => ({ getFinanceSanctionById: (id: string) => getById(id) }));
vi.mock("../../../_components/FinanceActions", () => ({ SanctionApproveAction: () => null }));
vi.mock("../../../../../_components/RaiseEOfficeNote", () => ({ RaiseEOfficeNote: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

import SanctionDetailPage from "./page";

describe("SanctionDetailPage error states (GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-02)", () => {
  beforeEach(() => getById.mockReset());

  it("500 -> load error with retry, never 'not found'", async () => {
    getById.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await SanctionDetailPage({ params: { id: "x" } }));
    expect(screen.getByText("We couldn't load sanction.")).toBeInTheDocument();
    expect(screen.queryByText("Sanction not found")).not.toBeInTheDocument();
  });

  it("404 -> 'Sanction not found'", async () => {
    getById.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await SanctionDetailPage({ params: { id: "x" } }));
    expect(screen.getByText("Sanction not found")).toBeInTheDocument();
  });

  it("403 -> permission copy, not 'not found'", async () => {
    getById.mockResolvedValue({ data: null, source: "error", status: 403 });
    render(await SanctionDetailPage({ params: { id: "x" } }));
    expect(screen.queryByText("Sanction not found")).not.toBeInTheDocument();
    expect(screen.queryByText("We couldn't load sanction.")).not.toBeInTheDocument();
  });
});
