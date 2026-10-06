import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const rolesMock = vi.fn(() => ["employee"] as string[]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));

const getTrainingProgramsMock = vi.fn();
const getMyNominationsMock = vi.fn();
const getMyProfileMock = vi.fn();
vi.mock("../_data", () => ({
  getTrainingPrograms: (...a: unknown[]) => getTrainingProgramsMock(...a),
  getMyNominations: (...a: unknown[]) => getMyNominationsMock(...a),
  getMyProfile: () => getMyProfileMock(),
  currentFinancialYearWindow: () => ({ from: "2026-04-01", to: "2027-03-31" }),
}));

import CalendarPage from "./page";

beforeEach(() => {
  rolesMock.mockReturnValue(["employee"]);
  getMyProfileMock.mockResolvedValue({ data: { id: "emp-7", name: "Vikram" }, source: "api" });
  getTrainingProgramsMock.mockResolvedValue({ data: [], source: "api" });
  getMyNominationsMock.mockResolvedValue({ data: [], source: "api" });
});

async function renderPage(search: Record<string, string> = {}) {
  render(await CalendarPage({ searchParams: search }));
}

describe("CalendarPage — GAP-LEARNING-CALENDAR-01/02/03/04/05/06", () => {
  it("CALENDAR-01: derives the employee from the session (no ?employeeId needed) and shows their name", async () => {
    getMyNominationsMock.mockResolvedValue({ data: [{ id: "n1", trainingTitle: "T", approvalState: "approved" }], source: "api" });
    await renderPage();
    expect(getMyNominationsMock).toHaveBeenCalledWith("emp-7");
    expect(screen.getByText(/My Nominations — Vikram/)).toBeInTheDocument();
  });

  it("CALENDAR-01: no linked record shows an honest message, not a uuid prompt", async () => {
    getMyProfileMock.mockResolvedValue({ data: null, source: "api", status: 404 });
    await renderPage();
    expect(screen.getByText("No employee record linked")).toBeInTheDocument();
    expect(screen.queryByText(/Append \?employeeId/)).not.toBeInTheDocument();
  });

  it("CALENDAR-03: subtitle no longer promises nominate/approve/waitlist actions", async () => {
    await renderPage();
    expect(screen.queryByText(/maker-checker/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/waitlisted/i)).not.toBeInTheDocument();
  });

  it("CALENDAR-02: programme dates are formatted (dd Mon yyyy), not raw ISO", async () => {
    getTrainingProgramsMock.mockResolvedValue({
      data: [{ id: "p1", title: "Prog", startDate: "2026-10-05", endDate: "2026-10-07", enrolledCount: 1, maxCapacity: 30 }],
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("05 Oct 2026 → 07 Oct 2026")).toBeInTheDocument();
    expect(screen.queryByText(/2026-10-05/)).not.toBeInTheDocument();
  });

  it("CALENDAR-05: a full programme shows a 'Full' cue; open capacity shows 'Open'", async () => {
    getTrainingProgramsMock.mockResolvedValue({
      data: [
        { id: "p1", title: "Full one", startDate: "2026-10-05", endDate: "2026-10-07", enrolledCount: 30, maxCapacity: 30 },
        { id: "p2", title: "Uncapped", startDate: "2026-10-05", endDate: "2026-10-07", enrolledCount: 2, maxCapacity: undefined },
      ],
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("30 / 30 · Full")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("CALENDAR-04: nominations failure shows a retry control (not a static empty state)", async () => {
    getMyNominationsMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("CALENDAR-06: requests a bounded financial-year window", async () => {
    await renderPage();
    expect(getTrainingProgramsMock).toHaveBeenCalledWith({ from: "2026-04-01", to: "2027-03-31" });
  });
});
