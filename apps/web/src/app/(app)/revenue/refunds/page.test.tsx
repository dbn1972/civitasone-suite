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

    expect(screen.getByRole("heading", { name: "Raise Refund" })).toBeInTheDocument();
    expect(screen.getByText(/RCPT-001/)).toBeInTheDocument();
  });

  it("shows the data-source badge instead of fabricating data on error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await RefundsPage({ searchParams: { assesseeId: ASSESSEE.id } });
    render(ui);

    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
  });

  it("never presents '0 receipts' as fact when the receipts fetch errored (CRITICAL-2 regression)", async () => {
    // Receipts fetch fails (e.g. 403) — the stat must show "—", never a fabricated "0".
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/receipts")) return Promise.resolve({ data: [], source: "error" });
      if (path.includes("/refunds?status=pending")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: [ASSESSEE], source: "api" });
    });
    const ui = await RefundsPage({ searchParams: { assesseeId: ASSESSEE.id } });
    render(ui);

    expect(screen.getByText("Receipts on record")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    // The create form must not render either — never let a checker/clerk act on an unknown receipt set.
    expect(screen.queryByRole("heading", { name: "Raise Refund" })).not.toBeInTheDocument();
  });

  it("lists refunds pending approval with a decide link (GAP-REVENUE-REFUNDS-01)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/refunds?status=pending")) {
        return Promise.resolve({
          data: [
            {
              id: "rf-1",
              receiptId: RECEIPT.id,
              assesseeId: ASSESSEE.id,
              amountMinor: "500050",
              reason: "Duplicate payment",
              status: "pending",
              createdAt: "2026-07-02T00:00:00.000Z",
            },
          ],
          source: "api",
        });
      }
      return Promise.resolve({ data: [ASSESSEE], source: "api" });
    });

    const ui = await RefundsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Pending approval")).toBeInTheDocument();
    expect(screen.getByText("Duplicate payment")).toBeInTheDocument();
    // A row link to the decide page must exist (checker can act without a UUID).
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/revenue/refunds/rf-1/decide")).toBe(true);
  });

  it("shows a retry state when the pending-refunds list fails (GAP-REVENUE-REFUNDS-01)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/refunds?status=pending")) return Promise.resolve({ data: [], source: "error" });
      return Promise.resolve({ data: [ASSESSEE], source: "api" });
    });

    const ui = await RefundsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("no longer leaks developer BACKEND FOLLOW-UPS text to end users (GAP-REVENUE-REFUNDS-03)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await RefundsPage({ searchParams: {} });
    render(ui);

    expect(screen.queryByText(/BACKEND FOLLOW-UPS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/in this PR/)).not.toBeInTheDocument();
    expect(screen.queryByText(/does not yet expose a list endpoint/)).not.toBeInTheDocument();
  });
});
