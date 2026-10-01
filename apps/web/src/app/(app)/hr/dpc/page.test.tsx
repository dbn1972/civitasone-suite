import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const getSessionRolesMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import DpcPage from "./page";

const ELIGIBLE_ROW = {
  employeeId: "e1", fullName: "A Kumar", department: "Home Affairs",
  designation: "Section Officer", grade: "Grade B", dateOfJoining: "2015-06-01",
  qualifyingYears: 10.5, eligibilityRank: 1,
};

interface MockEligibilityData {
  asOf: string;
  minQualifyingYears: number;
  eligibleCount: number;
  ineligibleCount: number;
  eligible: Array<typeof ELIGIBLE_ROW>;
  ineligible: Array<Record<string, unknown>>;
}

function mockEligibility(overrides: Partial<MockEligibilityData> = {}): MockEligibilityData {
  return { asOf: "2026-04-01", minQualifyingYears: 5, eligibleCount: 1, ineligibleCount: 0, eligible: [ELIGIBLE_ROW], ineligible: [], ...overrides };
}

function fetchJsonFor(urls: Record<string, unknown>) {
  return (url: string, fallback: unknown) => {
    for (const key of Object.keys(urls)) {
      if (url.includes(key)) return Promise.resolve(urls[key]);
    }
    return Promise.resolve({ data: fallback, source: "api" });
  };
}

function renderDpc() {
  return DpcPage().then((ui) =>
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>),
  );
}

describe("DpcPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReset();
  });

  it("GAP-HR-DPC-03: a manager (not seniority-admin) sees the eligibility stats/table but the page never even fetches promotions/seniority-lists", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    fetchJsonMock.mockImplementation(fetchJsonFor({
      "/dpc/eligibility": { data: mockEligibility(), source: "api" },
    }));

    await renderDpc();

    expect(screen.getByText("A Kumar")).toBeInTheDocument(); // eligibility table rendered with real data
    expect(screen.queryByText("DPC Batch Promotions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate Seniority List" })).not.toBeInTheDocument();

    const requestedUrls = fetchJsonMock.mock.calls.map((c) => c[0] as string);
    expect(requestedUrls.some((u) => u.includes("/lifecycle/promotions"))).toBe(false);
    expect(requestedUrls.some((u) => u.includes("/seniority/lists"))).toBe(false);
  });

  it("GAP-HR-DPC-03: an hr_admin session sees both the eligibility table and the (HR-only) batch-promotions card, each fetched", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockImplementation(fetchJsonFor({
      "/dpc/eligibility": { data: mockEligibility(), source: "api" },
      "/lifecycle/promotions": { data: [{ id: "p1", employeeName: "B Singh", status: "pending" }], source: "api" },
      "/seniority/lists": { data: [{ id: "l1", status: "generated", asOf: "2026-03-01", createdAt: "2026-03-01T00:00:00Z", approvedAt: null }], source: "api" },
    }));

    await renderDpc();

    expect(screen.getByText("DPC Batch Promotions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Seniority List" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve List l1…" })).toBeInTheDocument();
  });

  it("GAP-HR-DPC-03: for an hr_admin, the eligibility table still renders normally even though the (separately-fetched) promotions card errors — the whole page no longer collapses to 'Access restricted'", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockImplementation(fetchJsonFor({
      "/dpc/eligibility": { data: mockEligibility(), source: "api" },
      "/lifecycle/promotions": { data: [], source: "error", status: 500 },
      "/seniority/lists": { data: [], source: "api" },
    }));

    await renderDpc();

    // Eligibility content is intact — this is the core DPC-03 regression:
    // previously ANY promoSource==='error' forced `errored=true` globally,
    // which replaced this very table with PermissionDenied.
    expect(screen.getByText("A Kumar")).toBeInTheDocument();
    expect(screen.getByText("Home Affairs")).toBeInTheDocument();
    // Only the batch-promotions card itself shows the error state.
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("GAP-HR-DPC-05: subtitle and As On Date use the real minQualifyingYears and a formatted date, not a hard-coded '5 years' or a raw ISO string", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    fetchJsonMock.mockImplementation(fetchJsonFor({
      "/dpc/eligibility": { data: mockEligibility({ minQualifyingYears: 3, asOf: "2026-04-15" }), source: "api" },
    }));

    await renderDpc();

    expect(screen.getByText(/Minimum qualifying service: 3 years/)).toBeInTheDocument();
    expect(screen.queryByText("2026-04-15")).not.toBeInTheDocument();
    expect(screen.getAllByText(/15 Apr 2026/).length).toBeGreaterThanOrEqual(1);
  });

  it("GAP-HR-DPC-05: qualifyingYears and dateOfJoining render formatted, not as a raw float or ISO string", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    fetchJsonMock.mockImplementation(fetchJsonFor({
      "/dpc/eligibility": { data: mockEligibility(), source: "api" },
    }));

    await renderDpc();

    expect(screen.getByText("10.5 yrs")).toBeInTheDocument();
    expect(screen.getByText("01 Jun 2015")).toBeInTheDocument();
    expect(screen.queryByText("2015-06-01")).not.toBeInTheDocument();
  });

  it("GAP-HR-DPC-06: the Not Yet Eligible table has a title, is filterable, and shows the 'all eligible' empty state instead of being unreachable when ineligible is empty", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    fetchJsonMock.mockImplementation(fetchJsonFor({
      "/dpc/eligibility": { data: mockEligibility({ ineligible: [], ineligibleCount: 0 }), source: "api" },
    }));

    await renderDpc();

    expect(screen.getByText("Not Yet Eligible — Service Below Minimum")).toBeInTheDocument();
    expect(screen.getByText("All officers are eligible")).toBeInTheDocument();
  });

  it("GAP-HR-DPC-06: a non-empty ineligible list renders its rows under the same always-present title", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    fetchJsonMock.mockImplementation(fetchJsonFor({
      "/dpc/eligibility": {
        data: mockEligibility({
          ineligible: [{ employeeId: "e2", fullName: "C Rao", department: "Finance", grade: "Grade C", qualifyingYears: 2.1 }],
          ineligibleCount: 1,
        }),
        source: "api",
      },
    }));

    await renderDpc();

    expect(screen.getByText("Not Yet Eligible — Service Below Minimum")).toBeInTheDocument();
    expect(screen.getByText("C Rao")).toBeInTheDocument();
    expect(screen.getByText("2.1 yrs")).toBeInTheDocument();
  });
});
