import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getCrmGrievancesMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getCrmGrievances: (...args: unknown[]) => getCrmGrievancesMock(...args),
}));

import GrievancesPage from "./page";

function row(id: string, status: string) {
  return {
    id,
    referenceNo: `GRV/2026/${id}`,
    citizenName: `Citizen ${id}`,
    category: "water_supply",
    subject: `Grievance ${id}`,
    priority: "normal",
    status,
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
    expect(screen.getByText(/Escalated/).nextElementSibling).toHaveTextContent("1");
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
});
