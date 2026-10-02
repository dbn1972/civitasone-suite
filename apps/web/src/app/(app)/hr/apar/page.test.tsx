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

import AparListPage from "./page";

// APARFlowList/APARCard (rendered whenever `records` is non-empty -- and
// APARFlowList itself calls useTranslations unconditionally even for an
// empty list) are "use client" components using a plain useTranslations(),
// unlike DataTable's own useSafeTranslations fallback -- so every render
// here needs a real provider in the tree, same pattern as
// dpc/page.test.tsx and SeniorityListActions.test.tsx.
async function renderPage(searchParams: { status?: string; period?: string }) {
  const ui = await AparListPage({ searchParams });
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

/**
 * GAP-HR-APAR-01: the list page's stat cards and the flow cards' active
 * stage used to be computed from a status vocabulary the backend never
 * writes, so every card showed stage 1 and every counter but Total was 0.
 * The page now reads server-computed `counts` straight from the API
 * response instead of deriving them from the (possibly truncated) fetched
 * array — see repo.ts's countAparsByStatusGroup.
 *
 * GAP-HR-APAR-06: total/hasMore/status+period filters.
 */
describe("AparListPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReset();
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
  });

  it("denies a session with no APAR-eligible role", async () => {
    getSessionRolesMock.mockReturnValue(["citizen"]);
    await renderPage({});
    expect(screen.getByText(/do not have|permission|denied/i)).toBeInTheDocument();
  });

  it("renders server-computed counts on the stat cards, not a client-side re-derivation (GAP-HR-APAR-01)", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        records: [
          { id: "a1", employeeId: "e1", appraisalPeriod: "2025-26", status: "reviewing_officer", updatedAt: "2026-04-01T00:00:00Z" },
        ],
        total: 42,
        hasMore: false,
        counts: { selfPending: 3, inReview: 10, awaitingClosure: 4, finalised: 25 },
      },
    });

    await renderPage({});

    expect(screen.getByText("42")).toBeInTheDocument(); // Total
    expect(screen.getByText("3")).toBeInTheDocument();  // Self-Appraisal
    expect(screen.getByText("10")).toBeInTheDocument(); // Under Review
    expect(screen.getByText("4")).toBeInTheDocument();  // Awaiting Closure
    expect(screen.getByText("25")).toBeInTheDocument(); // Finalised
  });

  // GAP-HR-APPRAISALS-02: a single "how far along is this cycle" read,
  // distinct from the five stat tiles above.
  it("shows cycle progress as finalised-of-total with a percentage (GAP-HR-APPRAISALS-02)", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        records: [],
        total: 10,
        hasMore: false,
        counts: { selfPending: 2, inReview: 3, awaitingClosure: 1, finalised: 4 },
      },
    });

    await renderPage({});

    expect(screen.getByText("4 of 10 finalised (40%)")).toBeInTheDocument();
  });

  it("hides cycle progress on a genuine fetch failure, instead of a misleading 0% (GAP-HR-APPRAISALS-02)", async () => {
    fetchJsonMock.mockResolvedValue({ source: "error", data: null });

    await renderPage({});

    expect(screen.queryByText(/finalised \(/)).not.toBeInTheDocument();
  });

  it("hides cycle progress when the register is empty (no percentage of zero)", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: { records: [], total: 0, hasMore: false, counts: { selfPending: 0, inReview: 0, awaitingClosure: 0, finalised: 0 } },
    });

    await renderPage({});

    expect(screen.queryByText(/finalised \(/)).not.toBeInTheDocument();
  });

  it("hides cycle progress on a filtered view, where total and counts are different sets (GAP-HR-APPRAISALS-02)", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        records: [],
        total: 3,
        hasMore: false,
        counts: { selfPending: 0, inReview: 0, awaitingClosure: 0, finalised: 25 },
      },
    });

    await renderPage({ status: "finalised" });

    expect(screen.queryByText(/finalised \(/)).not.toBeInTheDocument();
  });

  it("shows an honest 'showing N of total' notice when the backend reports hasMore, instead of a silent cap (GAP-HR-APAR-06)", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: {
        records: Array.from({ length: 100 }, (_, i) => ({
          id: `a${i}`, employeeId: `e${i}`, appraisalPeriod: "2025-26", status: "self_pending", updatedAt: "2026-04-01T00:00:00Z",
        })),
        total: 150,
        hasMore: true,
        counts: { selfPending: 150, inReview: 0, awaitingClosure: 0, finalised: 0 },
      },
    });

    await renderPage({});

    expect(screen.getByText(/Showing 100 of 150/)).toBeInTheDocument();
  });

  it("forwards ?status=/?period= search params to the backend request", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: { records: [], total: 0, hasMore: false, counts: { selfPending: 0, inReview: 0, awaitingClosure: 0, finalised: 0 } },
    });

    await renderPage({ status: "reviewing_officer", period: "2025-26" });

    const [url] = fetchJsonMock.mock.calls[0] as [string];
    expect(url).toContain("status=reviewing_officer");
    expect(url).toContain("period=2025-26");
  });

  it("shows a retryable load-error state and hides the filter form on a genuine fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ source: "error", data: null });

    await renderPage({});

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
  });

  // GAP-HR-SF09A-010 / GAP-HR-APAR-04 (PR #1672): APAR_ROLES admits
  // manager/employee to this list, but POST /v1/hrms/apar (create) is
  // HR-only on the backend -- offering a button that always 403s on
  // arrival at /hr/apar/new is its own small UX bug on top of the role
  // mismatch. canInitiate (APAR_INITIATE_ROLES) controls the button here;
  // no test anywhere else in this PR or on main covered it directly.
  it("GAP-HR-SF09A-010: shows the Initiate APAR button for hr_admin", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: { records: [], total: 0, hasMore: false, counts: { selfPending: 0, inReview: 0, awaitingClosure: 0, finalised: 0 } },
    });
    await renderPage({});
    expect(screen.getByRole("link", { name: "+ Initiate APAR" })).toBeInTheDocument();
  });

  it("GAP-HR-SF09A-010: hides the Initiate APAR button for manager and employee (can view the list, cannot create)", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: { records: [], total: 0, hasMore: false, counts: { selfPending: 0, inReview: 0, awaitingClosure: 0, finalised: 0 } },
    });
    for (const role of ["manager", "employee"]) {
      getSessionRolesMock.mockReturnValue([role]);
      await renderPage({});
      expect(screen.queryByRole("link", { name: "+ Initiate APAR" })).not.toBeInTheDocument();
    }
  });
});
