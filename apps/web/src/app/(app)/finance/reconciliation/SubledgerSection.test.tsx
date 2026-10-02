import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { SubledgerSection } from "./SubledgerSection";

const AP = {
  side: "ap", controlAccountCode: "2100", controlAccountResolved: true, subledgerBalanceMinor: "500000",
  controlAccountBalanceMinor: "500000", differenceMinor: "0", isReconciled: true,
};

describe("SubledgerSection (GAP-FINANCE-RECONCILIATION-06)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders both sides", async () => {
    fetchJsonMock.mockImplementation((path: string) =>
      Promise.resolve(path.includes("side=ap")
        ? { data: AP, source: "api" }
        : { data: { ...AP, side: "ar", isReconciled: false, differenceMinor: "5000" }, source: "api" }),
    );
    render(await SubledgerSection());
    expect(screen.getByText("Reconciled")).toBeInTheDocument();
    expect(screen.getByText("Not reconciled")).toBeInTheDocument();
  });

  it("a failed side shows its own retryable error state, the other side still renders", async () => {
    fetchJsonMock.mockImplementation((path: string) =>
      Promise.resolve(path.includes("side=ap") ? { data: AP, source: "api" } : { data: null, source: "error", status: 500 }),
    );
    render(await SubledgerSection());
    expect(screen.getByText("Reconciled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("a 403 shows access restricted, not a retry", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 403, errorMessage: "forbidden" });
    render(await SubledgerSection());
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
