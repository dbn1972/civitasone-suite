import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getCrmRtiMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getCrmRti: (...args: unknown[]) => getCrmRtiMock(...args),
}));

import RtiPage from "./page";

function row(id: string, status: string, dueAt: string | null) {
  return {
    id,
    referenceNo: `RTI/2026/FIN/${id}`,
    section: "s.6",
    departmentRef: "Ministry of Finance",
    applicantName: `Applicant ${id}`,
    applicantContact: null,
    subject: `Request ${id}`,
    status,
    feePaid: false,
    feeAmount: null,
    receivedAt: "2026-08-01T00:00:00.000Z",
    dueAt,
    firstAppealDueAt: null,
    respondedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("RtiPage status-aware SLA tiles (GAP-CRM-RTI-01)", () => {
  beforeEach(() => {
    getCrmRtiMock.mockReset();
    vi.useRealTimers();
  });

  // A RESPONDED/REJECTED/DISPOSED request past its due date must NOT count as
  // overdue (that would read as an ongoing statutory breach for a closed
  // request). Only open requests past due are overdue. These fail on the old
  // code which bucketed purely on daysLeft(dueAt) ignoring status.
  it("excludes closed requests from Open and Overdue, counts only open rows past due", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T06:00:00.000Z"));

    const rows = [
      row("1", "RECEIVED", "2026-09-01T00:00:00.000Z"),      // open, past due -> overdue
      row("2", "TRANSFERRED", "2026-10-08T00:00:00.000Z"),   // open, 3 days   -> critical
      row("3", "RECEIVED", "2026-12-01T00:00:00.000Z"),      // open, far out  -> due (open, not overdue/critical)
      row("4", "RESPONDED", "2026-09-01T00:00:00.000Z"),     // closed past due -> NOT overdue, NOT open
      row("5", "REJECTED", "2026-09-01T00:00:00.000Z"),      // closed past due -> NOT overdue, NOT open
      row("6", "DISPOSED", "2026-09-01T00:00:00.000Z"),      // closed past due -> NOT overdue, NOT open
    ];
    getCrmRtiMock.mockResolvedValue({ data: { rows, total: rows.length }, source: "api" });

    const ui = await RtiPage({ searchParams: {} });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    // Open = 3 open rows (ids 1,2,3), NOT the 3 closed ones.
    expect(screen.getByText("Open (this page)").nextElementSibling).toHaveTextContent("3");
    // Overdue = only the open past-due row (id 1), none of the closed ones.
    expect(screen.getByText("Overdue (this page)").nextElementSibling).toHaveTextContent("1");
    // Critical = the open <7-days row (id 2).
    expect(screen.getByText(/Critical/).nextElementSibling).toHaveTextContent("1");
  });
});

describe("RtiPage pagination (GAP-CRM-RTI-02)", () => {
  beforeEach(() => {
    getCrmRtiMock.mockReset();
  });

  it("requests page 1 at the 50-row API limit and shows an honest whole-register window + pager", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(String(i + 1), "RECEIVED", "2026-12-01T00:00:00.000Z"));
    getCrmRtiMock.mockResolvedValue({ data: { rows, total: 120 }, source: "api" });

    const ui = await RtiPage({ searchParams: {} });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(getCrmRtiMock).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 50 }));
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 1–50 of 120");
    const next = screen.getByRole("link", { name: /Next/ });
    expect(next).toHaveAttribute("href", "/crm/rti?page=2");
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
  });

  it("reaches page 3 (rows 101–120), disables Next, and preserves filters in the pager link", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(String(101 + i), "FIRST_APPEAL", "2026-12-01T00:00:00.000Z"));
    getCrmRtiMock.mockResolvedValue({ data: { rows, total: 120 }, source: "api" });

    const ui = await RtiPage({ searchParams: { page: "3", status: "FIRST_APPEAL" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(getCrmRtiMock).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, limit: 50, status: "FIRST_APPEAL" }),
    );
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 101–120 of 120");
    expect(screen.getByText(/Page 3 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute(
      "href",
      "/crm/rti?status=FIRST_APPEAL&page=2",
    );
    expect(screen.queryByRole("link", { name: /Next/ })).not.toBeInTheDocument();
  });
});
