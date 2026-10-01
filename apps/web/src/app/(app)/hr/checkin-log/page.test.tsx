import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import CheckinLogPage from "./page";

// Matches the real GET /v1/hrms/attendance/checkin-log shape after
// GAP-HR-CHECKIN-LOG-02's queries.listCheckinLog: employee/department are
// now resolved names, not a UUID-prefix / permanently blank string.
const MOCK_ROWS = [
  { id: "c1", employeeId: "e1", employee: "Priya Nair", department: "Finance", date: "2026-09-01", checkIn: "09:05", checkOut: "17:32", source: "manual", totalHours: "8h 27m" },
  { id: "c2", employeeId: "e2", employee: "Arvind Kumar", department: "IT", date: "2026-09-02", checkIn: "09:00", checkOut: null, source: "regularisation", totalHours: "—" },
  { id: "c3", employeeId: "e3", employee: "Kiran Shah", department: "IT", date: "2026-09-03", checkIn: "08:55", checkOut: "17:00", source: "biometric", totalHours: "8h 5m" },
];

describe("CheckinLogPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  // GAP-HR-CHECKIN-LOG-01: the page used to read a `checkinSource` field
  // that never existed in the API response (the real field is `source`),
  // so the Source column was always blank and Biometric was always 0.
  it("GAP-HR-CHECKIN-LOG-01: renders a readable Source label for each row, never blank", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ROWS, source: "api" });
    render(await CheckinLogPage());
    // Scoped to the table: "Biometric" is also the stat tile's own label
    // text (statBiometricLabel), so an unscoped query would be ambiguous.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Manual")).toBeInTheDocument();
    expect(table.getByText("Regularised")).toBeInTheDocument();
    expect(table.getByText("Biometric")).toBeInTheDocument();
  });

  it("GAP-HR-CHECKIN-LOG-01: Biometric and Mobile/Manual tiles count only the rows they actually name, not total-minus-biometric", async () => {
    // 3 manual, 1 biometric, 1 regularisation. The old `items.length -
    // biometric` bug would compute Mobile/Manual as 5 - 1 = 4, folding the
    // regularisation row in; the fix must show exactly 3.
    const rows = [
      { ...MOCK_ROWS[0], id: "m1", source: "manual" },
      { ...MOCK_ROWS[0], id: "m2", source: "manual" },
      { ...MOCK_ROWS[0], id: "m3", source: "manual" },
      { ...MOCK_ROWS[0], id: "b1", source: "biometric" },
      { ...MOCK_ROWS[0], id: "r1", source: "regularisation" },
    ];
    fetchJsonMock.mockResolvedValue({ data: rows, source: "api" });
    render(await CheckinLogPage());
    expect(screen.getByText("Total Records")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument(); // total
    expect(screen.getByText("3")).toBeInTheDocument(); // Mobile/Manual: manual(3) + mobile(0), NOT 5-1=4
    expect(screen.queryByText("4")).not.toBeInTheDocument();
  });

  // GAP-HR-CHECKIN-LOG-03: date printed as the raw ISO string; missing
  // checkout rendered as an empty cell rather than an explicit "—".
  it("GAP-HR-CHECKIN-LOG-03: formats the date via the shared Indian date formatter and shows '—' for a missing checkout", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ROWS, source: "api" });
    render(await CheckinLogPage());
    expect(screen.queryByText("2026-09-01")).not.toBeInTheDocument();
    expect(screen.getByText("01 Sep 2026")).toBeInTheDocument();
    expect(screen.getByText("02 Sep 2026")).toBeInTheDocument();
    // c2's checkOut is null.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("falls back to a humanized label for an unforeseen source value instead of leaving it blank", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ ...MOCK_ROWS[0], source: "some_new_source" }],
      source: "api",
    });
    render(await CheckinLogPage());
    expect(screen.getByText("Some New Source")).toBeInTheDocument();
  });

  it("shows the error state on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await CheckinLogPage());
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
