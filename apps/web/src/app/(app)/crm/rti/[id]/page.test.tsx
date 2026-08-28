import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import RtiDetailPage from "./page";

const RTI = {
  id: "9e10b6c1-2222-4444-8888-000000000001",
  referenceNo: "RTI/2026/FINAN/ABC123",
  section: "s.6",
  departmentRef: "Ministry of Finance",
  applicantName: "Anil Sharma",
  applicantContact: "9876500000",
  subject: "Copy of sanctioned budget",
  description: "Please provide the FY26 budget breakup.",
  status: "RECEIVED",
  feePaid: true,
  feeAmount: 10,
  receivedAt: "2026-08-01T00:00:00.000Z",
  dueAt: "2026-08-31T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

// Regression test for the CRITICAL L1/L2 gap: RtiTable already links every
// row to /crm/rti/[id], and rti/new/page.tsx redirects there after filing,
// but this page did not exist at all — every such link 404'd. This proves
// the detail route now renders using the real GET /v1/crm/rti/:id shape.
describe("RtiDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the RTI request detail and its lifecycle actions", async () => {
    fetchJsonMock.mockResolvedValue({ data: RTI, source: "api" });

    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(ui);

    expect(screen.getAllByText(RTI.referenceNo).length).toBeGreaterThan(0);
    expect(screen.getByText(RTI.applicantName)).toBeInTheDocument();
    expect(screen.getByText(RTI.description)).toBeInTheDocument();
    // RECEIVED status -> Forward/Respond actions available, not First Appeal.
    expect(screen.getByRole("button", { name: "Forward" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Respond" })).toBeInTheDocument();
  });

  it("shows a not-found message instead of crashing for a bogus id", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "api" });

    const ui = await RtiDetailPage({ params: { id: "does-not-exist" } });
    render(ui);

    expect(screen.getByText("RTI Request Not Found")).toBeInTheDocument();
  });

  it("does not claim a cached view when the fetch actually failed", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error" });

    const ui = await RtiDetailPage({ params: { id: RTI.id } });
    render(ui);

    expect(screen.getByText("RTI Request Not Found")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
