import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import ShiftsPage from "./page";

const MOCK_SHIFTS = [
  { id: "s1", name: "General Duty", startTime: "09:00", endTime: "17:30", breakDuration: "30 min", workingHours: "8 hrs", applicableTo: "All Cadres", status: "active" },
  { id: "s2", name: "Night Shift", startTime: "22:00", endTime: "06:00", breakDuration: "30 min", workingHours: "7.5 hrs", applicableTo: "Essential Services", status: "active" },
];

describe("ShiftsPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

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
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("falls back to government standard shifts when API returns empty", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await ShiftsPage());
    expect(screen.getAllByText("General Duty").length).toBeGreaterThan(0);
    expect(screen.getAllByText("09:00").length).toBeGreaterThan(0);
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
