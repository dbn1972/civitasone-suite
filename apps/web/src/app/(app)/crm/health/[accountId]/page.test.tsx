import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider as __Intl } from "next-intl";
import __enMessages from "@/messages/en.json";
function render(ui: React.ReactElement) {
  return rtlRender(<__Intl locale="en" messages={__enMessages}>{ui}</__Intl>);
}

const getBreakdownMock = vi.fn();
const getAccountsMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getAccountHealthBreakdown: (...a: unknown[]) => getBreakdownMock(...a),
  getCrmAccounts: (...a: unknown[]) => getAccountsMock(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import AccountHealthDetailPage from "./page";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function withIntl(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

function breakdown() {
  return {
    accountId: ACCOUNT_ID,
    score: 42,
    band: "at_risk" as const,
    version: 3,
    computedAt: "2026-08-01T10:00:00.000Z",
    storedScore: 42,
    contributingFactors: [],
  };
}

function account(id: string, name: string) {
  return { id, name, industry: null, website: null, parentId: null, contactCount: 0 };
}

describe("AccountHealthDetailPage title (GAP-CRM-HEALTH-ACCOUNTID-01)", () => {
  beforeEach(() => {
    getBreakdownMock.mockReset();
    getAccountsMock.mockReset();
  });

  // Regression: the title was a fixed "Account Health" — a clerk could not tell
  // which account the page described. It must now show the resolved name.
  it("uses the resolved account name as the page title", async () => {
    getBreakdownMock.mockResolvedValue({ data: breakdown(), source: "api" });
    getAccountsMock.mockResolvedValue({ data: [account(ACCOUNT_ID, "Bharat Steel Ltd")], source: "api" });

    const ui = await AccountHealthDetailPage({ params: { accountId: ACCOUNT_ID } });
    render(withIntl(ui));

    expect(screen.getByRole("heading", { name: "Bharat Steel Ltd" })).toBeInTheDocument();
    // The old fixed title must be gone.
    expect(screen.queryByRole("heading", { name: "Account Health" })).not.toBeInTheDocument();
  });

  // If the name lookup fails/misses, the page still renders with a fallback
  // title (name + short id), never crashing.
  it("falls back to a short-id title when the account name cannot be resolved", async () => {
    getBreakdownMock.mockResolvedValue({ data: breakdown(), source: "api" });
    getAccountsMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await AccountHealthDetailPage({ params: { accountId: ACCOUNT_ID } });
    render(withIntl(ui));

    expect(screen.getByRole("heading", { name: /Account health · 11111111/ })).toBeInTheDocument();
  });

  // GAP-CRM-HEALTH-ACCOUNTID-02 — a 5xx/network error shows a retry state, not
  // "This account has not been scored".
  it("renders a retry error state (not 'not scored') on a 500", async () => {
    getBreakdownMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    getAccountsMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await AccountHealthDetailPage({ params: { accountId: ACCOUNT_ID } });
    render(ui);

    expect(screen.queryByText(/has not been scored/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No health score yet")).not.toBeInTheDocument();
    // RefreshErrorState offers a "Try again" affordance.
    expect(screen.getAllByText(/Try again/i).length).toBeGreaterThan(0);
  });

  it("renders the 'not scored yet' empty state on a 404", async () => {
    getBreakdownMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    getAccountsMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await AccountHealthDetailPage({ params: { accountId: ACCOUNT_ID } });
    render(ui);

    expect(screen.getByText("No health score yet")).toBeInTheDocument();
    // Not the retry error state.
    expect(screen.queryByText(/Try again/i)).not.toBeInTheDocument();
  });

  // GAP-CRM-HEALTH-ACCOUNTID-05 — contribution carries a "pts" unit and the
  // Data Quality column exposes a Clamped explanation.
  it("formats contribution with a pts unit and offers a Clamped explanation", async () => {
    getBreakdownMock.mockResolvedValue({
      data: {
        ...breakdown(),
        contributingFactors: [
          { signal: "productUsage", value: 72, weight: 0.25, contribution: 18, clamped: true },
        ],
      },
      source: "api",
    });
    getAccountsMock.mockResolvedValue({ data: [account(ACCOUNT_ID, "Bharat Steel")], source: "api" });

    const ui = await AccountHealthDetailPage({ params: { accountId: ACCOUNT_ID } });
    render(ui);

    expect(screen.getByText(/\+18 pts/)).toBeInTheDocument();
    // The Clamped help affordance is present.
    expect(screen.getByRole("button", { name: /What is Clamped/i })).toBeInTheDocument();
  });

  // GAP-CRM-HEALTH-ACCOUNTID-07 — the stored-vs-computed card shows the compute
  // time and uses theme tokens, not a hard-coded #475569 / pastel hex.
  it("shows the compute time inside the recompute card and uses no literal hex", async () => {
    getBreakdownMock.mockResolvedValue({
      data: { ...breakdown(), storedScore: 50, score: 42 },
      source: "api",
    });
    getAccountsMock.mockResolvedValue({ data: [account(ACCOUNT_ID, "Bharat Steel")], source: "api" });

    const ui = await AccountHealthDetailPage({ params: { accountId: ACCOUNT_ID } });
    const { container } = render(ui);

    expect(screen.getByText("Score Recomputed From Signals")).toBeInTheDocument();
    expect(screen.getByText(/Computed/)).toBeInTheDocument();
    const html = container.innerHTML;
    for (const hex of ["#475569", "#fee2e2", "#fef3c7", "#e0f2fe", "#dcfce7"]) {
      expect(html).not.toContain(hex);
    }
  });
});
