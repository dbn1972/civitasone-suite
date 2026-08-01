import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import RefundsPage from "./page";

const ASSESSEE = {
  id: "11111111-1111-1111-1111-111111111111",
  ownerName: "Ravi Kumar",
  identifierNo: "PMC-0001",
  assesseeType: "residential",
};

const RECEIPT = {
  id: "22222222-2222-2222-2222-222222222222",
  receiptNo: "RCPT-001",
  demandId: "33333333-3333-3333-3333-333333333333",
  amountMinor: "500050",
  channel: "online",
  reference: "UTR123",
  status: "reconciled",
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("RefundsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts for an assessee when none is selected", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ASSESSEE], source: "api" });
    const ui = await RefundsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Choose an assessee")).toBeInTheDocument();
  });

  it("renders receipts eligible for refund once an assessee is selected", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/receipts")) return Promise.resolve({ data: [RECEIPT], source: "api" });
      return Promise.resolve({ data: [ASSESSEE], source: "api" });
    });
    const ui = await RefundsPage({ searchParams: { assesseeId: ASSESSEE.id } });
    render(ui);

    expect(screen.getByText("Raise Refund")).toBeInTheDocument();
    expect(screen.getByText(/RCPT-001/)).toBeInTheDocument();
  });

  it("shows the data-source badge instead of fabricating data on error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await RefundsPage({ searchParams: { assesseeId: ASSESSEE.id } });
    render(ui);

    expect(screen.getAllByText("Showing saved information").length).toBeGreaterThan(0);
  });

  it("documents the missing list endpoint instead of fabricating a refund register", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ASSESSEE], source: "api" });
    const ui = await RefundsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText(/does not yet expose a list endpoint for refunds/)).toBeInTheDocument();
  });
});
