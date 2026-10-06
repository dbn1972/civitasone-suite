import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getCrmGrievancesMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getCrmGrievances: (...args: unknown[]) => getCrmGrievancesMock(...args),
}));

const rolesMock = vi.fn(() => [] as string[]);
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => rolesMock() };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import GrievancesPage from "./page";

function row(id: string, status: string, dueAt?: string) {
  return {
    id,
    referenceNo: `GRV/2026/${id}`,
    citizenName: `Citizen ${id}`,
    category: "water_supply",
    subject: `Grievance ${id}`,
    priority: "normal",
    status,
    assignedTo: null,
    dueAt: dueAt ?? null,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

const ROWS = [
  row("1", "REGISTERED"),
  row("2", "FORWARDED"),
  row("3", "ATTENDED"),
  row("4", "APPEAL"),
  row("5", "DISPOSED"),
  row("6", "DISPOSED"),
];

describe("GrievancesPage stat cards", () => {
  beforeEach(() => {
    getCrmGrievancesMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["crm_admin"]);
  });

  // Regression test for the HIGH bug: the Open/Escalated/Resolved stat
  // cards compared r.status against a legacy open/escalated/resolved/closed
  // vocabulary the backend stopped returning after the CPGRAMS migration
  // (real values are REGISTERED/FORWARDED/ATTENDED/DISPOSED/APPEAL) — every
  // bucket always showed 0 regardless of the real register.
  it("buckets the real CPGRAMS statuses correctly instead of always showing 0", async () => {
    getCrmGrievancesMock.mockResolvedValue({
      data: { rows: ROWS, total: ROWS.length },
      source: "api",
    });

    const ui = await GrievancesPage({ searchParams: {} });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    // 3 open (REGISTERED/FORWARDED/ATTENDED), 1 escalated (APPEAL), 2 resolved (DISPOSED).
    expect(screen.getByText("Open (this page)").nextElementSibling).toHaveTextContent("3");
    expect(screen.getByText(/First appeal/).nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText(/Resolved/).nextElementSibling).toHaveTextContent("2");
  });

  // GAP-CRM-GRIEVANCES-01 — the loader paginates at 50 rows/page, but the page
  // used to request only page 1 and render no pager, so rows 51+ were
  // unreachable. These assertions fail on the old code: it passed no `page` to
  // the loader and rendered no "Showing x-y of total" header or Prev/Next pager.
  it("requests page 1 at the 50-row API limit and shows an honest whole-register window", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(String(i + 1), "REGISTERED"));
    getCrmGrievancesMock.mockResolvedValue({ data: { rows, total: 120 }, source: "api" });

    const ui = await GrievancesPage({ searchParams: {} });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(getCrmGrievancesMock).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 50 }));
    // Honest register-wide window, not just "this page".
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 1–50 of 120");
    // A pager exists and page 2 is reachable (120 rows / 50 = 3 pages).
    const next = screen.getByRole("link", { name: /Next/ });
    expect(next).toHaveAttribute("href", "/crm/grievances?page=2");
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
  });

  it("reaches page 3 and shows rows 101–120, preserving filters in pager links", async () => {
    // Page 3 of a 120-row register holds the last 20 rows (101–120).
    const rows = Array.from({ length: 20 }, (_, i) => row(String(101 + i), "REGISTERED"));
    getCrmGrievancesMock.mockResolvedValue({ data: { rows, total: 120 }, source: "api" });

    const ui = await GrievancesPage({ searchParams: { page: "3", status: "REGISTERED" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(getCrmGrievancesMock).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, limit: 50, status: "REGISTERED" }),
    );
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 101–120 of 120");
    expect(screen.getByText(/Page 3 of 3/)).toBeInTheDocument();
    // Filter is carried through the pager link; only `page` changes.
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute(
      "href",
      "/crm/grievances?status=REGISTERED&page=2",
    );
    // On the last page there is no further "next" page link.
    expect(screen.queryByRole("link", { name: /Next/ })).not.toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-02 — the page now renders server-side filter controls
  // (status/priority selects + a whole-register search box).
  it("renders the server-side filter controls", async () => {
    getCrmGrievancesMock.mockResolvedValue({ data: { rows: ROWS, total: ROWS.length }, source: "api" });
    const ui = await GrievancesPage({ searchParams: {} });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByLabelText("Filter by status")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by priority")).toBeInTheDocument();
    expect(screen.getByLabelText(/Search reference, citizen or subject/i)).toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-03 — on an outage the page shows a retry error state,
  // NOT the "No grievances yet" first-use empty copy.
  it("renders a retry error state (not the empty register copy) on a load error", async () => {
    getCrmGrievancesMock.mockResolvedValue({ data: { rows: [], total: 0 }, source: "error", status: 500 });
    const ui = await GrievancesPage({ searchParams: {} });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.queryByText(/No grievances yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
    // Tiles show the honest "—" dash, not a false 0.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  // GAP-CRM-GRIEVANCES-04 — an Overdue tile counts non-disposed rows past due.
  it("counts overdue (non-disposed, past-due) grievances on this page", async () => {
    const past = "2020-01-01T00:00:00.000Z";
    const rows = [
      row("1", "REGISTERED", past), // overdue
      row("2", "DISPOSED", past),   // past due but disposed → not overdue
      row("3", "FORWARDED", "2999-01-01T00:00:00.000Z"), // future → not overdue
    ];
    getCrmGrievancesMock.mockResolvedValue({ data: { rows, total: 3 }, source: "api" });
    const ui = await GrievancesPage({ searchParams: {} });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText(/Overdue \(this page\)/).nextElementSibling).toHaveTextContent("1");
  });

  // GAP-CRM-GRIEVANCES-05 — the CSV export (which carries citizen names) is only
  // offered to roles with export rights.
  it("hides the CSV export button for a role without export rights", async () => {
    rolesMock.mockReturnValue(["crm_user"]);
    getCrmGrievancesMock.mockResolvedValue({ data: { rows: ROWS, total: ROWS.length }, source: "api" });
    const ui = await GrievancesPage({ searchParams: {} });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.queryByRole("button", { name: /CSV/i })).not.toBeInTheDocument();
  });

  it("shows the CSV export button for a role with export rights", async () => {
    rolesMock.mockReturnValue(["crm_admin"]);
    getCrmGrievancesMock.mockResolvedValue({ data: { rows: ROWS, total: ROWS.length }, source: "api" });
    const ui = await GrievancesPage({ searchParams: {} });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.getByRole("button", { name: /CSV/i })).toBeInTheDocument();
  });
});
