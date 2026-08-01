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

  it("shows the data-source badge on error instead of a friendly empty state", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.endsWith(`/assessees/${ID}`)) return Promise.resolve({ data: ASSESSEE, source: "error" });
      return Promise.resolve({ data: [], source: "error" });
    });

    const ui = await AssesseeDetailPage({ params: { id: ID } });
    render(ui);

    expect(screen.getAllByText("Showing saved information").length).toBeGreaterThan(0);
  });
});
