import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

import AssesseeDetailPage from "./page";

const ID = "11111111-1111-1111-1111-111111111111";

const ASSESSEE = {
  id: ID,
  assesseeType: "property",
  identifierNo: "PROP-0001",
  ownerName: "Ramesh Kumar",
  address: "12 MG Road",
  wardNo: "4",
  zoneNo: "1",
  propertyType: "residential",
  isActive: true,
};

const DCB = { totalDemand: "500000", totalCollected: "200000", balance: "300000" };

function mockAllSuccess() {
  fetchJsonMock.mockImplementation((path: string) => {
    if (path.endsWith(`/assessees/${ID}`)) return Promise.resolve({ data: ASSESSEE, source: "api" });
    if (path.includes("/dcb")) return Promise.resolve({ data: DCB, source: "api" });
    if (path.includes("/demands")) return Promise.resolve({ data: [], source: "api" });
    if (path.includes("/bills")) return Promise.resolve({ data: [], source: "api" });
    if (path.includes("/receipts")) return Promise.resolve({ data: [], source: "api" });
    if (path.includes("/instalments")) return Promise.resolve({ data: [], source: "api" });
    return Promise.resolve({ data: null, source: "api" });
  });
}

describe("AssesseeDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the assessee and DCB snapshot", async () => {
    mockAllSuccess();
    const ui = await AssesseeDetailPage({ params: { id: ID } });
    render(ui);

    expect(screen.getByText("Ramesh Kumar")).toBeInTheDocument();
    expect(screen.getByText(/PROP-0001/)).toBeInTheDocument();
    expect(screen.getAllByText("₹3,000.00").length).toBeGreaterThan(0);
  });

  it("labels bank reconciliation distinctly from receipt status (DETAIL-04)", async () => {
    const { fireEvent } = await import("@testing-library/react");
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.endsWith(`/assessees/${ID}`)) return Promise.resolve({ data: ASSESSEE, source: "api" });
      if (path.includes("/dcb")) return Promise.resolve({ data: DCB, source: "api" });
      if (path.includes("/receipts"))
        return Promise.resolve({
          data: [
            {
              id: "r1",
              receiptNo: "RCT-1",
              channel: "counter",
              amountMinor: "1000",
              status: "posted",
              reconciled: false,
              createdAt: "2026-07-01T00:00:00.000Z",
            },
          ],
          source: "api",
        });
      return Promise.resolve({ data: [], source: "api" });
    });
    const ui = await AssesseeDetailPage({ params: { id: ID } });
    render(ui);
    fireEvent.click(screen.getByRole("tab", { name: "Receipts" }));
    expect(screen.getByText("Bank reconciled")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.queryByText("No")).not.toBeInTheDocument();
  });

  it("offers deep-link actions preselecting this assessee (DETAIL-01)", async () => {
    mockAllSuccess();
    const ui = await AssesseeDetailPage({ params: { id: ID } });
    render(ui);
    const receipt = screen.getByRole("link", { name: "Record receipt" });
    expect(receipt).toHaveAttribute("href", `/revenue/receipts?assesseeId=${ID}`);
    expect(screen.getByRole("link", { name: "Generate bill" })).toHaveAttribute(
      "href",
      `/revenue/bills?assesseeId=${ID}`,
    );
  });

  it("shows a per-section retry state when only receipts fail, not a false 'No receipts' (DETAIL-03)", async () => {
    const { fireEvent } = await import("@testing-library/react");
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.endsWith(`/assessees/${ID}`)) return Promise.resolve({ data: ASSESSEE, source: "api" });
      if (path.includes("/dcb")) return Promise.resolve({ data: DCB, source: "api" });
      if (path.includes("/receipts")) return Promise.resolve({ data: [], source: "error" });
      return Promise.resolve({ data: [], source: "api" });
    });
    const ui = await AssesseeDetailPage({ params: { id: ID } });
    render(ui);
    fireEvent.click(screen.getByRole("tab", { name: "Receipts" }));
    expect(screen.queryByText("No receipts recorded")).not.toBeInTheDocument();
    expect(screen.getByText("We couldn't load receipts.")).toBeInTheDocument();
    // Receipts stat shows "—", not 0.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("shows an honest error title + retry when the assessee record itself fails (DETAIL-05)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.endsWith(`/assessees/${ID}`)) return Promise.resolve({ data: null, source: "error" });
      return Promise.resolve({ data: [], source: "error" });
    });
    const ui = await AssesseeDetailPage({ params: { id: ID } });
    render(ui);
    expect(screen.getAllByText("Assessee unavailable").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("We couldn't load this assessee.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
