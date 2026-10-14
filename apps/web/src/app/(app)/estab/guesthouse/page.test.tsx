import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getGuesthouseBookingsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getGuesthouseBookings: () => getGuesthouseBookingsMock(),
}));
let mockRoles: string[] = ["estab_officer"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
  ESTAB_DFA_DRAFTER_ROLES: ["estab_officer", "estab_admin", "super_admin"],
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import GuesthousePage from "./page";

describe("GuesthousePage — GUESTHOUSE-03/05", () => {
  beforeEach(() => {
    getGuesthouseBookingsMock.mockReset();
    mockRoles = ["estab_officer"];
  });

  it("GUESTHOUSE-05: shows a back-to-hub link and a New Booking action in the empty state", async () => {
    getGuesthouseBookingsMock.mockResolvedValueOnce({ data: [], source: "api" });
    const ui = await GuesthousePage();
    render(ui);

    // Back link to the estab hub.
    const back = screen.getByRole("link", { name: /back/i });
    expect(back).toHaveAttribute("href", "/estab");
    // Empty state offers New Booking.
    expect(screen.getByText("No bookings found")).toBeInTheDocument();
    const newLinks = screen.getAllByRole("link", { name: /New Booking/ });
    expect(newLinks.some((l) => l.getAttribute("href") === "/estab/guesthouse/new")).toBe(true);
  });

  it("GUESTHOUSE-03: renders a Department column and separate Check-in/Check-out columns with time", async () => {
    getGuesthouseBookingsMock.mockResolvedValueOnce({
      data: [
        {
          id: "b1",
          bookingNo: "GH/2026/001",
          guestName: "Shri A. Kumar",
          designation: "Director",
          department: "Health",
          checkInDate: "2026-10-01T08:30:00.000Z", // 14:00 IST
          checkOutDate: "2026-10-03T08:30:00.000Z",
          roomNo: "101",
          status: "confirmed",
        },
      ],
      source: "api",
    });
    const ui = await GuesthousePage();
    render(ui);

    expect(screen.getByText("Department")).toBeInTheDocument();
    expect(screen.getByText("Check-in")).toBeInTheDocument();
    expect(screen.getByText("Check-out")).toBeInTheDocument();
    expect(screen.getByText("Health")).toBeInTheDocument();
    // Time of day is shown (02:00 pm IST), proving date-time not date-only.
    expect(screen.getByText(/01 Oct 2026, 02:00 pm/i)).toBeInTheDocument();
  });
});

describe("GuesthousePage — GUESTHOUSE-01 (check-in/check-out actions)", () => {
  beforeEach(() => {
    getGuesthouseBookingsMock.mockReset();
  });

  it("shows a Check-in button for a confirmed booking row", async () => {
    getGuesthouseBookingsMock.mockResolvedValueOnce({
      data: [
        {
          id: "b1",
          bookingNo: "GH/2026/001",
          guestName: "Test Guest",
          department: "Admin",
          checkInDate: "2026-10-01T08:30:00.000Z",
          checkOutDate: "2026-10-03T08:30:00.000Z",
          roomNo: "102",
          status: "confirmed",
        },
      ],
      source: "api",
    });
    const ui = await GuesthousePage();
    render(ui);

    // A confirmed booking must show the Check-in action.
    expect(screen.getByRole("button", { name: "Check in" })).toBeInTheDocument();
    // No Check-out for a confirmed booking.
    expect(screen.queryByRole("button", { name: "Check out" })).not.toBeInTheDocument();
  });

  it("shows a Check-out button for a checked_in booking row", async () => {
    getGuesthouseBookingsMock.mockResolvedValueOnce({
      data: [
        {
          id: "b2",
          bookingNo: "GH/2026/002",
          guestName: "In-house Guest",
          department: "Health",
          checkInDate: "2026-09-28T08:30:00.000Z",
          checkOutDate: "2026-10-01T08:30:00.000Z",
          roomNo: "103",
          status: "checked_in",
        },
      ],
      source: "api",
    });
    const ui = await GuesthousePage();
    render(ui);

    // A checked-in booking must show the Check-out action.
    expect(screen.getByRole("button", { name: "Check out" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check in" })).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-GUESTHOUSE-01: no approvals claim; check-in is offered only to establishment officers", async () => {
    const row = {
      id: "b2", bookingNo: "GH/2026/002", guestName: "Smt. B. Rao", designation: null, department: "Law",
      checkInDate: "2026-10-01T08:30:00.000Z", checkOutDate: "2026-10-03T08:30:00.000Z", roomNo: "102", status: "confirmed",
    };
    getGuesthouseBookingsMock.mockResolvedValue({ data: [row], source: "api" });

    mockRoles = ["estab_officer"];
    const { unmount } = render(await GuesthousePage());
    expect(screen.queryByText(/approvals/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Check in" })).toBeInTheDocument();
    unmount();

    mockRoles = ["employee"];
    render(await GuesthousePage());
    expect(screen.queryByRole("button", { name: "Check in" })).toBeNull();
  });
});
