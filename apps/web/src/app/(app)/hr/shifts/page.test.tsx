import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  { id: "s1", name: "General Duty", startTime: "09:00", endTime: "17:30", breakDuration: "30 min", workingHours: "8 hrs", applicableTo: "All Cadres", status: "active" },
  { id: "s2", name: "Night Shift", startTime: "22:00", endTime: "06:00", breakDuration: "30 min", workingHours: "7.5 hrs", applicableTo: "Essential Services", status: "active" },
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
