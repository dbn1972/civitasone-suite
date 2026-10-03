import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["finance_admin"], getSessionUserId: () => "viewer-1" }));

import FiscalYearsPage from "./page";

// The page now renders the pending-approvals panel (a client component using next-intl).
const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const PENDING = {
  id: "r1", kind: "fiscal_year_activate", subjectKey: "2027-28", payload: { code: "2027-28" }, reason: "Year-end rollover approved",
  status: "pending", requestedBy: "someone-else", requestedAt: "2027-03-31T10:00:00.000Z", decidedBy: null, decidedAt: null, decisionNote: null, version: 1,
};

/** One mock for every loader: fiscal years / periods get `fy`, change requests and settings get their own. */
function respond(fy: unknown, requests: unknown = { data: [], source: "api" }, settings: unknown = { data: { makerCheckerEnabled: true, fyCreateAsDraft: true }, source: "api" }) {
  fetchJsonMock.mockImplementation(async (url: string) => {
    if (String(url).includes("change-requests")) return requests;
    if (String(url).includes("finance/settings")) return settings;
    return fy;
  });
}

describe("FiscalYearsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of fiscal years", async () => {
    respond({
      data: [
        { code: "2025-26", label: "FY 2025-26", startDate: "2025-04-01", endDate: "2026-03-31", status: "closed" },
        { code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" },
      ],
      source: "api",
    });

    const ui = await FiscalYearsPage();
    render(ui);

    expect(screen.getByText("FY 2025-26")).toBeInTheDocument();
    expect(screen.getByText("FY 2026-27")).toBeInTheDocument();
  });

  it("renders an empty state when there are no fiscal years", async () => {
    respond({ data: [], source: "api" });

    const ui = await FiscalYearsPage();
    render(ui);

    expect(screen.getByText("No fiscal years yet")).toBeInTheDocument();
  });

  // GAP-FINANCE-FISCAL-YEARS-03
  it("a failed load shows the retry state: no Total 0, no create prompt, no create form", async () => {
    respond({ data: [], source: "error", status: 502 });

    const ui = await FiscalYearsPage();
    render(ui);

    expect(screen.getByRole("button", { name: /try again|retry|refresh/i })).toBeInTheDocument();
    expect(screen.queryByText("Total Fiscal Years")).not.toBeInTheDocument();
    expect(screen.queryByText(/Create the first fiscal year/)).not.toBeInTheDocument();
    expect(screen.queryByText("Create Fiscal Year")).not.toBeInTheDocument();
  });

  it("a genuine empty tenant (source api, 0 rows) still gets the create prompt and form", async () => {
    respond({ data: [], source: "api" });

    const ui = await FiscalYearsPage();
    render(ui);

    expect(screen.getByText("Total Fiscal Years")).toBeInTheDocument();
    expect(screen.getAllByText("Create Fiscal Year").length).toBeGreaterThan(0);
  });

  // fp-finance-01 (GAP-FINANCE-FISCAL-YEARS-01/-02): activation waits for a second officer
  it("lists activation requests waiting for a different finance administrator, with Approve / Reject for the viewer", async () => {
    respond(
      { data: [{ code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" },
               { code: "2027-28", label: "FY 2027-28", startDate: "2027-04-01", endDate: "2028-03-31", status: "draft" }], source: "api" },
      { data: [PENDING], source: "api" },
    );
    render(await FiscalYearsPage());
    expect(screen.getByText("Changes awaiting a second officer")).toBeInTheDocument();
    expect(screen.getByText(/Activate fiscal year: 2027-28/)).toBeInTheDocument();
    expect(screen.getByText(/Year-end rollover approved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    // the table row says it is awaiting approval instead of offering a second Activate
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate fiscal year 2027-28" })).not.toBeInTheDocument();
  });

  it("a failed pending-approvals read is its own retry state, never 'nothing is waiting'", async () => {
    respond(
      { data: [{ code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" }], source: "api" },
      { data: [], source: "error", status: 500 },
    );
    render(await FiscalYearsPage());
    expect(screen.queryByText("No changes are waiting for approval.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry|refresh/i })).toBeInTheDocument();
  });

  it("nothing pending is a real, quiet empty state", async () => {
    respond({ data: [{ code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" }], source: "api" });
    render(await FiscalYearsPage());
    expect(screen.getByText("No changes are waiting for approval.")).toBeInTheDocument();
  });
});
