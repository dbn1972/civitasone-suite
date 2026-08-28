import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ReconciliationRunDetailPage from "./page";

const RUN = {
  id: "11111111-1111-1111-1111-111111111111",
  provider: "book-vs-bank",
  sourceSystem: "finance-book",
  targetSystem: "bank-statement",
  status: "completed",
  sourceCount: 100,
  targetCount: 98,
  matchedCount: 95,
  breakCount: 1,
  balanced: false,
  startedAt: "2026-07-01T00:00:00.000Z",
  completedAt: "2026-07-01T00:05:00.000Z",
};

const EXCEPTION = {
  id: "22222222-2222-2222-2222-222222222222",
  runId: RUN.id,
  provider: "book-vs-bank",
  breakKey: "UTR12345",
  breakType: "value_mismatch",
  field: "amountMinor",
  fieldType: "amount",
  sourceValue: "100000",
  targetValue: "99000",
  deltaMinor: "-1000",
  severity: "high",
  status: "open",
  resolutionNote: null,
  resolvedBy: null,
  resolvedAt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("ReconciliationRunDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the run and its exceptions", async () => {
    fetchJsonMock.mockResolvedValue({ data: { data: RUN, breaks: [EXCEPTION] }, source: "api" });

    const ui = await ReconciliationRunDetailPage({ params: { id: RUN.id } });
    render(ui);

    expect(screen.getByText(/Recon Run — book-vs-bank/)).toBeInTheDocument();
    expect(screen.getByText("UTR12345")).toBeInTheDocument();
  });

  it("renders the data-source badge on error instead of fabricating a run", async () => {
    fetchJsonMock.mockResolvedValue({ data: { data: null, breaks: [] }, source: "error" });

    const ui = await ReconciliationRunDetailPage({ params: { id: RUN.id } });
    render(ui);

    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
  });
});
