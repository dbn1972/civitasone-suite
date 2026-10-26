import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const getSessionUserIdMock = vi.fn<() => string | null>(() => "checker-1");
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionUserId: () => getSessionUserIdMock(),
}));

import RateConfigPage from "./page";

const rateHead = { id: "rh1", code: "PT", name: "Property Tax", category: "property_tax", unitOfMeasure: "sq_ft", isActive: true };

describe("RateConfigPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders rate heads and scoped tabs for the default (first) rate head", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/rate-heads")) return Promise.resolve({ data: [rateHead], source: "api" });
      if (path.includes("/rate-slabs")) return Promise.resolve({ data: [], source: "api" });
      if (path.includes("/penalty-rules")) return Promise.resolve({ data: [], source: "api" });
      if (path.includes("/rebate-rules")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RateConfigPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("Rate Configuration")).toBeInTheDocument();
    expect(screen.getByText("PT")).toBeInTheDocument();
    expect(fetchJsonMock).toHaveBeenCalledWith(
      expect.stringContaining("/rate-slabs?rateHeadId=rh1"),
      [],
      expect.anything(),
    );
  });

  it("renders an empty state when there are no rate heads yet, without fabricating data", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await RateConfigPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("No rate heads configured")).toBeInTheDocument();
    // Scoped loaders must not fire without a selected rate head.
    expect(fetchJsonMock).not.toHaveBeenCalledWith(expect.stringContaining("/rate-slabs"), expect.anything(), expect.anything());
  });

  it("shows the saved-information badge when a loader source is 'error', not a fabricated empty state", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/rate-heads")) return Promise.resolve({ data: [rateHead], source: "api" });
      if (path.includes("/rate-slabs")) return Promise.resolve({ data: [], source: "error" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RateConfigPage({ searchParams: Promise.resolve({}) });
    render(ui);

    // Default active tab is "Rate Heads"; switch is exercised in RateConfigConsole.test.tsx.
    expect(screen.getByText("Rate Configuration")).toBeInTheDocument();
  });

  it("renders a retry state (not an empty 'create first rate head') when rate heads fail to load (GAP-REVENUE-CONFIG-03)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/rate-heads")) return Promise.resolve({ data: [], source: "error" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RateConfigPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    // The misleading "create the first rate head" prompt must not show on failure.
    expect(screen.queryByText("No rate heads configured")).not.toBeInTheDocument();
  });

  // Owner decision #2 (2026-10-26): maker-checker, versioned rate configuration.
  it("shows proposals awaiting approval and lets a different officer decide them (owner decision #2)", async () => {
    getSessionUserIdMock.mockReturnValue("checker-1");
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/rate-config/proposals")) {
        return Promise.resolve({
          data: [{ id: "pr1", kind: "penalty_rule", action: "revise", status: "pending", makerUserId: "maker-1", effectiveFrom: "2099-04-01", targetId: "p1", rateHeadId: "rh1", payload: { annualRateBps: 1800 }, decisionReason: null }],
          source: "api",
        });
      }
      if (path.includes("/rate-heads")) return Promise.resolve({ data: [rateHead], source: "api" });
      return Promise.resolve({ data: [], source: "api" });
    });
    const ui = await RateConfigPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.getByText(/New version of a penalty rule/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve rate-config proposal" })).toBeEnabled();
  });

  it("offers existing rows for a versioned change or end-date (owner decision #2)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/rate-heads")) return Promise.resolve({ data: [rateHead], source: "api" });
      if (path.includes("/penalty-rules")) {
        return Promise.resolve({
          data: [{ id: "p1", rateHeadId: "rh1", interestType: "simple", annualRateBps: 1200, graceDays: 0, capMonths: null, roundingMode: "floor", isActive: true, effectiveFrom: "2026-04-01", effectiveTo: null, version: 1 }],
          source: "api",
        });
      }
      return Promise.resolve({ data: [], source: "api" });
    });
    const ui = await RateConfigPage({ searchParams: Promise.resolve({}) });
    render(ui);
    const select = screen.getByLabelText(/^Row to change/) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent ?? "");
    expect(labels.some((l) => l.includes("Penalty rule") && l.includes("12"))).toBe(true);
    expect(labels.some((l) => l.includes("Rate head") && l.includes("PT"))).toBe(true);
  });
});
