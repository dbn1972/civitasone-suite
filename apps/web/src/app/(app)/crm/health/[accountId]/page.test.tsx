import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
});
