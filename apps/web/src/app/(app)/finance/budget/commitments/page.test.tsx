import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockRoles: string[] = ["finance_officer"];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));
const getCommitments = vi.fn();
const getLines = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getFinanceCommitments: (fy?: string) => getCommitments(fy),
  getFinanceBudgetMonitoringLines: (fy?: string) => getLines(fy),
}));
vi.mock("../../_components/FyFilter", () => ({ FyFilter: () => null }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null, provenance: "live" }),
}));
vi.mock("next-intl/server", async () => {
  const en = (await import("@/messages/en.json")).default as unknown as Record<string, Record<string, string>>;
  return { getTranslations: async (ns: string) => (key: string) => en[ns]?.[key] ?? key };
});
vi.mock("next-intl", async () => {
  const en = (await import("@/messages/en.json")).default as unknown as Record<string, Record<string, string>>;
  return { useTranslations: (ns: string) => (key: string) => en[ns]?.[key] ?? key };
});

import CommitmentRegisterPage from "./page";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

const HEAD = "11111111-1111-4111-8111-111111111111";
const row = (o: Record<string, unknown> = {}) => ({
  id: "c1", budget_head_id: HEAD, reference_type: "purchase_order", reference_id: "p1", reference_no: "PO/2026-27/0042",
  committed_minor: "1250000", released_minor: "250000", balance_minor: "1000000", fy: "2026-27", status: "partially_released",
  committed_at: "2026-05-04T06:30:00Z", ...o,
});

describe("Commitment register page", () => {
  beforeEach(() => {
    mockRoles = ["finance_officer"];
    getCommitments.mockReset().mockResolvedValue({ data: [row()], source: "api" });
    getLines.mockReset().mockResolvedValue({ data: [{ headId: HEAD, headCode: "2202", headName: "General Education" }], source: "api" });
  });

  it("requests the register for the resolved FY and renders rows with head name and exact amounts", async () => {
    render(await CommitmentRegisterPage({ searchParams: { fy: "2026-27" } }));
    expect(getCommitments).toHaveBeenCalledWith("2026-27");
    expect(screen.getByText("PO/2026-27/0042")).toBeInTheDocument();
    expect(screen.getByText("2202 · General Education")).toBeInTheDocument();
    expect(screen.getAllByText("₹12,500.00").length).toBeGreaterThan(0);
  });

  it("falls back to the current FY on a malformed ?fy=", async () => {
    await CommitmentRegisterPage({ searchParams: { fy: "bogus" } });
    expect(getCommitments).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/));
  });

  it("shows an empty state, not zero rows silently", async () => {
    getCommitments.mockResolvedValue({ data: [], source: "api" });
    render(await CommitmentRegisterPage({ searchParams: {} }));
    expect(screen.getByText("No commitments")).toBeInTheDocument();
  });

  it("shows an error state (no table, no fake zeros) when the fetch fails", async () => {
    getCommitments.mockResolvedValue({ data: [], source: "error" });
    render(await CommitmentRegisterPage({ searchParams: {} }));
    expect(screen.queryByText("No commitments")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("denies a role outside the backend's finance roles without fetching", async () => {
    mockRoles = ["hr_admin"];
    render(await CommitmentRegisterPage({ searchParams: {} }));
    expect(getCommitments).not.toHaveBeenCalled();
  });
});

describe("financeCommitments i18n parity", () => {
  it("hi has exactly the en keys", () => {
    const e = Object.keys((en as Record<string, object>).financeCommitments).sort();
    const h = Object.keys((hi as Record<string, object>).financeCommitments).sort();
    expect(h).toEqual(e);
  });
});
