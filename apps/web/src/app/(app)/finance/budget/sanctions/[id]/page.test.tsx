import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getById = vi.fn();
vi.mock("../../../../../_data/loaders", () => ({ getFinanceSanctionById: (id: string) => getById(id) }));
vi.mock("../../../_components/FinanceActions", () => ({ SanctionApproveAction: () => null }));
vi.mock("../../../../../_components/RaiseEOfficeNote", () => ({ RaiseEOfficeNote: () => null }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["finance_officer"] }));
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

describe("SanctionDetailPage approval trail timestamps (GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-06)", () => {
  beforeEach(() => getById.mockReset());
  const base = {
    id: "s1", sanctionNo: "SAN-1", subject: "Road", amount: "100000", sanctionedBy: "A", date: "2026-03-05",
    status: "approved", majorHead: "2059", remarks: null, lineItems: [],
  };

  it("a cancelled (eOffice-rejected) sanction is not treated as pending: no approval guidance", async () => {
    getById.mockResolvedValue({ data: { ...base, status: "cancelled", approvalTrail: [] }, source: "api" });
    render(await SanctionDetailPage({ params: { id: "s1" } }));
    expect(screen.queryByText(/Approve directly|Only a finance administrator/)).not.toBeInTheDocument();
  });

  it("an ISO timestamp renders as an IST date and time, not the raw string", async () => {
    getById.mockResolvedValue({
      data: { ...base, approvalTrail: [{ actor: "B", action: "approved", timestamp: "2026-03-05T09:00:00.000Z" }] },
      source: "api",
    });
    render(await SanctionDetailPage({ params: { id: "s1" } }));
    expect(screen.getByText(/05 Mar 2026, 02:30/i)).toBeInTheDocument();
    expect(screen.queryByText("2026-03-05T09:00:00.000Z")).not.toBeInTheDocument();
  });

  it("an invalid or missing timestamp renders a dash", async () => {
    getById.mockResolvedValue({
      data: { ...base, approvalTrail: [{ actor: "B", action: "approved", timestamp: "not-a-date" }, { actor: "C", action: "noted", timestamp: "" }] },
      source: "api",
    });
    render(await SanctionDetailPage({ params: { id: "s1" } }));
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("not-a-date")).not.toBeInTheDocument();
  });
});
