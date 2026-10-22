import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const rolesMock = vi.fn(() => [] as string[]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));

import ShiftsPage from "./page";

const MOCK_SHIFTS = [
  { id: "s1", name: "General Duty", startTime: "09:00", endTime: "17:30", gracePeriod: "15 min", workingHours: "8h 30m", applicableTo: "All Cadres", status: "active", graceMinutes: 15 },
  { id: "s2", name: "Night Shift", startTime: "22:00", endTime: "06:00", gracePeriod: "15 min", workingHours: "8h 0m", applicableTo: "Essential Services", status: "active", graceMinutes: 15 },
];

// The real API shape (attendance/repo.ts listShifts): numeric minutes only,
// cross-midnight already wrapped by the backend (22:00-06:00 -> 480).
const API_SHIFTS = [
  { id: "s1", name: "General Duty", startTime: "09:00", endTime: "17:30", graceMinutes: 10, workingMinutes: 510, applicableTo: "All", status: "active" },
  { id: "s2", name: "Night Shift", startTime: "22:00", endTime: "06:00", graceMinutes: 15, workingMinutes: 480, applicableTo: "All", status: "active" },
  { id: "s3", name: "Flexi", startTime: "10:00", endTime: "10:45", graceMinutes: 0, workingMinutes: 45, applicableTo: "All", status: "active" },
];

describe("ShiftsPage", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); rolesMock.mockReset(); rolesMock.mockReturnValue([]); });

  // GAP-HR-SHIFTS-01: create/edit is offered to HR roles only (the API
  // re-checks server-side; this just stops showing a control that would 403).
  it("shows Add shift / Edit to an HR officer", async () => {
    rolesMock.mockReturnValue(["hr_officer"]);
    fetchJsonMock.mockResolvedValue({ data: MOCK_SHIFTS, source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{await ShiftsPage()}</NextIntlClientProvider>);
    expect(screen.getByRole("button", { name: "Add shift" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit shift General Duty" })).toBeInTheDocument();
  });

  it("shows no management controls to a manager or employee", async () => {
    for (const roles of [["manager"], ["employee"], []]) {
      rolesMock.mockReturnValue(roles);
      fetchJsonMock.mockResolvedValue({ data: MOCK_SHIFTS, source: "api" });
      const { unmount } = render(await ShiftsPage());
      expect(screen.queryByRole("button", { name: "Add shift" })).toBeNull();
      unmount();
    }
  });

  it("renders shift definitions from API", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_SHIFTS, source: "api" });
    render(await ShiftsPage());
    // Each shift name legitimately appears twice by design: once in the
    // ShiftCard grid above, once in the "All Shift Definitions" table row.
    expect(screen.getAllByText("General Duty").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Night Shift").length).toBeGreaterThan(0);
  });

  it("renders stat cards with counts", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_SHIFTS, source: "api" });
    render(await ShiftsPage());
    expect(screen.getByText("Total Shifts")).toBeInTheDocument();
    // "Active" also appears as each row's StatusPill, so pin the stat-card
    // label specifically (class "lab") rather than any "Active" text.
    const statLabels = screen.getAllByText("Active").filter((el) => el.classList.contains("lab"));
    expect(statLabels).toHaveLength(1);
  });

  // COMP-004 fix-up (round 3): the page used to silently substitute a
  // hardcoded 4-row "GOVT_SHIFTS" fallback (fake IDs like "dopt-general")
  // whenever the real API returned zero rows, whether that meant a genuine
  // tenant with no shifts configured (source: "api", []) or a real fetch
  // failure (source: "error"). These two tests prove neither case renders
  // that fabricated data any more.
  it("shows an honest empty state when a tenant genuinely has no shifts (source: api, [])", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await ShiftsPage());
    expect(screen.getByText("No shifts defined")).toBeInTheDocument();
    // None of the fabricated GOVT_SHIFTS rows/ids ever render.
    expect(screen.queryByText("General Duty")).not.toBeInTheDocument();
    expect(screen.queryByText("Morning Shift")).not.toBeInTheDocument();
    expect(screen.queryByText("Evening Shift")).not.toBeInTheDocument();
    expect(screen.queryByText(/dopt-/)).not.toBeInTheDocument();
    // Honest zero counts, not counts derived from fake rows.
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("shows the error state with no fake rows underneath on a real fetch failure (source: error)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await ShiftsPage());
    // The error UI is shown...
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    // ...and nothing else claims to be real data underneath it: no fake
    // rows, and no honest-empty-state message either (that would wrongly
    // imply the load succeeded and the tenant just has no shifts).
    expect(screen.queryByText("General Duty")).not.toBeInTheDocument();
    expect(screen.queryByText(/dopt-/)).not.toBeInTheDocument();
    expect(screen.queryByText("No shifts defined")).not.toBeInTheDocument();
    // StatCards show "—" rather than a fabricated 0 or a count of fake rows.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows link to shift change requests", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_SHIFTS, source: "api" });
    render(await ShiftsPage());
    expect(screen.getByRole("link", { name: /change requests/i })).toHaveAttribute("href", "/hr/shift-requests");
  });

  it("renders ShiftCard view for shifts", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_SHIFTS, source: "api" });
    render(await ShiftsPage());
    // ShiftCard renders article elements
    expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
  });

  it("renders the All Shift Definitions table header", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_SHIFTS, source: "api" });
    render(await ShiftsPage());
    expect(screen.getByText("All Shift Definitions")).toBeInTheDocument();
  });
});

// GAP-HR-SHIFTS-02: run the page's REAL mapResponse over the API's actual
// shape. The register used to key its Grace column off a `breakDuration` the
// API no longer returns, so every row showed a dash and grace minutes were
// never displayed; ShiftCard still called the same value "Break".
describe("ShiftsPage grace period and working time (GAP-HR-SHIFTS-02)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue([]);
    fetchJsonMock.mockImplementation(async (_url: string, _fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => ({
      data: opts.mapResponse({ data: API_SHIFTS }),
      source: "api",
    }));
  });

  function rowFor(name: string): HTMLElement {
    const table = screen.getByRole("table");
    const cell = within(table).getByText(name);
    return cell.closest("tr") as HTMLElement;
  }

  it("labels the column 'Grace period' (not Break) and shows each shift's grace minutes", async () => {
    render(await ShiftsPage());
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: /grace period/i })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /^break/i })).toBeNull();
    expect(within(rowFor("General Duty")).getByText("10 min")).toBeInTheDocument();
    expect(within(rowFor("Night Shift")).getByText("15 min")).toBeInTheDocument();
    // zero grace is real data, shown as 0 min -- not a dash standing in for "unknown"
    expect(within(rowFor("Flexi")).getByText("0 min")).toBeInTheDocument();
  });

  it("shows a cross-midnight night shift (22:00-06:00) as 8h 0m, not a dash", async () => {
    render(await ShiftsPage());
    expect(within(rowFor("Night Shift")).getByText("8h 0m")).toBeInTheDocument();
    expect(within(rowFor("General Duty")).getByText("8h 30m")).toBeInTheDocument();
    expect(within(rowFor("Flexi")).getByText("45 min")).toBeInTheDocument();
  });

  it("the shift cards carry the same grace period under a Grace label, never 'Break'", async () => {
    render(await ShiftsPage());
    const night = screen.getByRole("article", { name: /night shift/i });
    expect(within(night).getByText("Grace")).toBeInTheDocument();
    expect(within(night).getByText("15 min")).toBeInTheDocument();
    expect(within(night).getByText("8h 0m")).toBeInTheDocument();
    expect(within(night).queryByText("Break")).toBeNull();
  });
});
