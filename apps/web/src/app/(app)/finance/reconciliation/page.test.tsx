import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// The subledger card is an async server component streamed under <Suspense>;
// it has its own test (SubledgerSection.test.tsx), so it is stubbed here.
vi.mock("./SubledgerSection", () => ({ SubledgerSection: () => <p>subledger stub</p> }));

const rolesMock = vi.fn<() => string[]>(() => []);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));

import ReconciliationWorkbenchPage from "./page";

const RUN = {
  id: "11111111-1111-1111-1111-111111111111",
  provider: "book-vs-bank",
  sourceSystem: "finance-book",
  targetSystem: "bank-statement",
  status: "completed",
  sourceCount: 100,
  targetCount: 98,
  matchedCount: 95,
  breakCount: 5,
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

const SUBLEDGER_AP = {
  side: "ap",
  controlAccountCode: "2100",
  controlAccountResolved: true,
  subledgerBalanceMinor: "500000",
  controlAccountBalanceMinor: "500000",
  differenceMinor: "0",
  isReconciled: true,
};

const SUBLEDGER_AR = {
  side: "ar",
  controlAccountCode: "1300",
  controlAccountResolved: true,
  subledgerBalanceMinor: "300000",
  controlAccountBalanceMinor: "295000",
  differenceMinor: "5000",
  isReconciled: false,
};

function mockAllSuccess() {
  fetchJsonMock.mockImplementation((path: string) => {
    if (path.includes("/recon/runs")) return Promise.resolve({ data: [RUN], source: "api" });
    if (path.includes("/recon/exceptions")) return Promise.resolve({ data: [EXCEPTION], source: "api" });
    if (path.includes("/recon/providers")) {
      return Promise.resolve({
        data: [{ key: "book-vs-bank", sourceSystem: "finance-book", targetSystem: "bank-statement" }],
        source: "api",
      });
    }
    if (path.includes("side=ap")) return Promise.resolve({ data: SUBLEDGER_AP, source: "api" });
    if (path.includes("side=ar")) return Promise.resolve({ data: SUBLEDGER_AR, source: "api" });
    return Promise.resolve({ data: null, source: "api" });
  });
}

describe("ReconciliationWorkbenchPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReset().mockReturnValue([]);
  });

  it("renders runs and exceptions", async () => {
    mockAllSuccess();
    const ui = await ReconciliationWorkbenchPage();
    render(ui);

    expect(screen.getAllByText("book-vs-bank").length).toBeGreaterThan(0);
    expect(screen.getByText("UTR12345")).toBeInTheDocument();
    expect(screen.getByText("subledger stub")).toBeInTheDocument();
  });

  it("renders empty states when there is no data", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("side=ap") || path.includes("side=ar")) return Promise.resolve({ data: null, source: "api" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await ReconciliationWorkbenchPage();
    render(ui);

    expect(screen.getByText("No reconciliation runs yet")).toBeInTheDocument();
    expect(screen.getByText("No exceptions")).toBeInTheDocument();
  });

  it("shows the data-source badge instead of a friendly empty state on error", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("side=ap") || path.includes("side=ar")) return Promise.resolve({ data: null, source: "error" });
      return Promise.resolve({ data: [], source: "error" });
    });

    const ui = await ReconciliationWorkbenchPage();
    render(ui);

    // each failed section has its own retryable error state (GAP-FINANCE-RECONCILIATION-06)
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("No reconciliation runs yet")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-RECONCILIATION-07: the footer date is the newest run, not runs[0].
  it("shows the newest run date in the footer even when the API order is oldest-first", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/recon/runs"))
        return Promise.resolve({
          data: [
            { ...RUN, startedAt: "2026-07-01T00:00:00.000Z" },
            { ...RUN, id: "99999999-9999-9999-9999-999999999999", startedAt: "2026-09-15T00:00:00.000Z" },
          ],
          source: "api",
        });
      return Promise.resolve({ data: [], source: "api" });
    });
    render(await ReconciliationWorkbenchPage());
    expect(screen.getByText(/Last run started .*(15\/09\/2026|15 Sep 2026)/)).toBeInTheDocument();
  });

  // GAP-FINANCE-RECONCILIATION-03: audit_officer sees no action buttons.
  it("renders exceptions read-only for an audit_officer session", async () => {
    mockAllSuccess();
    rolesMock.mockReturnValue(["audit_officer"]);
    render(await ReconciliationWorkbenchPage());
    expect(screen.getByText("UTR12345")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Write off exception/)).not.toBeInTheDocument();
  });

  it("offers actions to a finance_admin session", async () => {
    mockAllSuccess();
    rolesMock.mockReturnValue(["finance_admin"]);
    render(await ReconciliationWorkbenchPage());
    expect(screen.getByLabelText("Write off exception UTR12345")).toBeInTheDocument();
  });
});
