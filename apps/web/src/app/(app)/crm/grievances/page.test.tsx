import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
    render(ui);

    // 3 open (REGISTERED/FORWARDED/ATTENDED), 1 escalated (APPEAL), 2 resolved (DISPOSED).
    expect(screen.getByText("Open (this page)").nextElementSibling).toHaveTextContent("3");
    expect(screen.getByText(/Escalated/).nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText(/Resolved/).nextElementSibling).toHaveTextContent("2");
  });
});
