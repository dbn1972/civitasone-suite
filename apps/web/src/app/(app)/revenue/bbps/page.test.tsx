import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import BbpsPage from "./page";

describe("BbpsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the fetch-bill and pay-bill forms", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await BbpsPage();
    render(ui);
    expect(screen.getByText("BBPS Bill Fetch & Pay")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Fetch BBPS bill" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Record BBPS payment" })).toBeInTheDocument();
  });

  it("shows the Recent BBPS requests card with rows (GAP-REVENUE-BBPS-02)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "r1", bbpsTxnId: "TXN-1", status: "failed", requestType: "pay", amountMinor: "100000", failureReason: "exceeds outstanding", createdAt: "2026-07-01T10:00:00.000Z" },
      ],
      source: "api",
    });
    const ui = await BbpsPage();
    render(ui);
    expect(screen.getByText("Recent BBPS requests")).toBeInTheDocument();
    expect(screen.getByText("TXN-1")).toBeInTheDocument();
    expect(screen.getByText("exceeds outstanding")).toBeInTheDocument();
  });

  it("shows a retry state when the recent-requests fetch fails", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await BbpsPage();
    render(ui);
    expect(screen.getByText("We couldn't load recent BBPS requests.")).toBeInTheDocument();
  });
});
