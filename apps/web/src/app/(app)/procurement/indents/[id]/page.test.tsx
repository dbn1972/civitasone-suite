import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import IndentDetailPage from "./page";

/**
 * Mocks the single getProcurementIndentById fetch. The real mapper
 * (mapProcurementIndentDetail) is applied to `payload` so the component sees
 * exactly what production would.
 */
function route(payload: unknown, source: "api" | "error" = "api") {
  fetchJsonMock.mockImplementation(
    (_path: unknown, _empty: unknown, options?: { mapResponse?: (p: unknown) => unknown }) => {
      const mapped = options?.mapResponse ? options.mapResponse(payload) : payload;
      return Promise.resolve({ data: source === "error" ? null : mapped, source });
    },
  );
}

const BASE = {
  id: "ind-1",
  indentNo: "IND-2026-001",
  requestedBy: "Ram Kumar",
  department: "Housing & Urban Development",
  itemCount: 2,
  totalMinor: 25000000,
  indentDate: "2026-09-01",
  requiredBy: "2026-09-20",
  purpose: "Replace failed site survey equipment before the monsoon audit.",
  lineItems: [
    { itemCode: "SRV-1", description: "Total station", quantity: 1, unitPriceMinor: 25000000 },
  ],
  approvalTrail: [
    { actor: "A. Clerk", action: "submitted", timestamp: "2026-09-01T09:30:00Z", remarks: "Raised" },
    { actor: "B. Officer", action: "rejected", timestamp: "2026-09-02T04:00:00Z", remarks: "Budget head exhausted" },
  ],
};

describe("IndentDetailPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("DETAIL-02: shows the purpose / justification text", async () => {
    route({ ...BASE, status: "pending" });
    render(await IndentDetailPage({ params: { id: "ind-1" } }));
    expect(screen.getByText(/Replace failed site survey equipment/)).toBeInTheDocument();
    expect(screen.getByText("Purpose / justification")).toBeInTheDocument();
  });

  it("DETAIL-03: renders the approval-trail timestamp in Indian date+time, not raw ISO", async () => {
    route({ ...BASE, status: "rejected" });
    render(await IndentDetailPage({ params: { id: "ind-1" } }));
    // 2026-09-01T09:30:00Z -> 01 Sep 2026, 03:00 pm (IST, +5:30)
    expect(screen.getByText(/01 Sep 2026, 03:00 pm/i)).toBeInTheDocument();
    // The raw ISO must not be shown.
    expect(screen.queryByText("2026-09-01T09:30:00Z")).not.toBeInTheDocument();
  });

  it("DETAIL-03: a rejected step shows an emphasised 'Reason:' prefix", async () => {
    route({ ...BASE, status: "rejected" });
    render(await IndentDetailPage({ params: { id: "ind-1" } }));
    expect(screen.getByText(/Reason: Budget head exhausted/)).toBeInTheDocument();
  });

  it("DETAIL-04: renders exactly one status pill and no hard-coded hex colours", async () => {
    route({ ...BASE, status: "approved" });
    const { container } = render(await IndentDetailPage({ params: { id: "ind-1" } }));
    const pills = container.querySelectorAll('[class*="pill"]');
    expect(pills.length).toBe(1);
    expect(container.innerHTML).not.toMatch(/#818cf8|#1e293b|#64748b/i);
  });

  it("DETAIL-01: an approved indent offers a 'Create purchase order' next step", async () => {
    route({ ...BASE, status: "approved" });
    render(await IndentDetailPage({ params: { id: "ind-1" } }));
    const link = screen.getByRole("link", { name: "Create purchase order" });
    expect(link).toHaveAttribute("href", "/procurement/orders/new");
  });

  it("DETAIL-01: a pending indent links to the approvals queue", async () => {
    route({ ...BASE, status: "pending" });
    render(await IndentDetailPage({ params: { id: "ind-1" } }));
    const link = screen.getByRole("link", { name: "View in approvals" });
    expect(link).toHaveAttribute("href", "/procurement/approvals");
  });

  it("DETAIL-01: a tender_required indent links to tender creation", async () => {
    route({ ...BASE, status: "tender_required" });
    render(await IndentDetailPage({ params: { id: "ind-1" } }));
    const link = screen.getByRole("link", { name: "Create tender" });
    expect(link).toHaveAttribute("href", "/procurement/tenders/new");
  });

  it("DETAIL-01: a closed indent offers no next-step action link", async () => {
    route({ ...BASE, status: "closed" });
    render(await IndentDetailPage({ params: { id: "ind-1" } }));
    expect(screen.queryByRole("link", { name: "Create purchase order" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View in approvals" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create tender" })).not.toBeInTheDocument();
  });
});
