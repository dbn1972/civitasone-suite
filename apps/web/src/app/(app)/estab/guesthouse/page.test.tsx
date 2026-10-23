import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

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

describe("GuesthousePage - check-in/out times as the service sends them (GAP-ESTAB-GUESTHOUSE-03)", () => {
  beforeEach(() => {
    getGuesthouseBookingsMock.mockReset();
    mockRoles = ["estab_officer"];
  });

  const row = (over: Record<string, unknown>) => ({
    id: "b1", bookingNo: "B1", guestName: "Shri A. Kumar", department: "Health", status: "confirmed", ...over,
  });

  it("an instant that falls on the next IST calendar day is shown on that day, with its time", async () => {
    // 03 Oct 2026 19:00 UTC is 04 Oct 2026 00:30 IST: a UTC date cut would name the wrong day.
    getGuesthouseBookingsMock.mockResolvedValueOnce({
      data: [row({ checkInDate: "2026-10-01T08:30:00.000Z", checkOutDate: "2026-10-03T19:00:00.000Z" })],
      source: "api",
    });
    render(await GuesthousePage());
    expect(screen.getByText(/01 Oct 2026, 02:00 pm/i)).toBeInTheDocument();
    expect(screen.getByText(/04 Oct 2026, 12:30 am/i)).toBeInTheDocument();
  });

  it("a bare calendar date (no time of day) is shown as the date it is, never as a fabricated 05:30 am", async () => {
    getGuesthouseBookingsMock.mockResolvedValueOnce({
      data: [row({ checkInDate: "2026-10-01", checkOutDate: "2026-10-03" })],
      source: "api",
    });
    render(await GuesthousePage());
    expect(screen.getByText("01 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText("03 Oct 2026")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/05:30/);
  });
});

describe("GuesthousePage - check-out records the charges the officer states (GAP-ESTAB-GUESTHOUSE-01)", () => {
  beforeEach(() => {
    getGuesthouseBookingsMock.mockReset();
    mockRoles = ["estab_officer"];
    vi.restoreAllMocks();
  });

  const IN_HOUSE = {
    id: "b2", bookingNo: "B2", guestName: "In-house Guest", department: "Health", roomNo: "103", status: "checked_in",
    checkInDate: "2026-09-28T08:30:00.000Z", checkOutDate: "2026-10-01T08:30:00.000Z",
  };

  function spyPatch() {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify({ id: "b2", status: "accepted", correlationId: "c" }), { status: 202 });
    });
    return calls;
  }
  async function openCheckout() {
    getGuesthouseBookingsMock.mockResolvedValue({ data: [IN_HOUSE], source: "api" });
    render(await GuesthousePage());
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    const dialog = await screen.findByRole("alertdialog");
    return { dialog, confirm: within(dialog).getByRole("button", { name: "Check out" }) };
  }

  it("a blank amount is not read as 0: confirm stays disabled until the officer states the charges", async () => {
    const { confirm } = await openCheckout();
    expect(confirm).toBeDisabled();
  });

  it("sends the typed rupees as exact integer paise (1,500.50 -> 150050)", async () => {
    const calls = spyPatch();
    const { dialog, confirm } = await openCheckout();
    fireEvent.change(within(dialog).getByLabelText(/Charges collected/), { target: { value: "1,500.50" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toContain("/room-bookings/b2/checkout");
    expect(calls[0]!.body).toEqual({ chargesMinor: 150050 });
  });

  it("an explicit 0 is sent as 0 (nothing charged), by the officer's statement", async () => {
    const calls = spyPatch();
    const { dialog, confirm } = await openCheckout();
    fireEvent.change(within(dialog).getByLabelText(/Charges collected/), { target: { value: "0" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toEqual({ chargesMinor: 0 });
  });

  it("a sub-paise or non-numeric amount is refused with a message and nothing is sent", async () => {
    const calls = spyPatch();
    const { dialog, confirm } = await openCheckout();
    for (const bad of ["12.345", "abc", "-5", "1e3"]) {
      fireEvent.change(within(dialog).getByLabelText(/Charges collected/), { target: { value: bad } });
      expect(confirm).toBeDisabled();
      const why = within(dialog).getByText(/Enter the charges as an amount in rupees/);
      expect(why.getAttribute("role")).toBe("alert");
    }
    expect(calls).toHaveLength(0);
  });

  it("check-in still sends no charges", async () => {
    const calls = spyPatch();
    getGuesthouseBookingsMock.mockResolvedValue({ data: [{ ...IN_HOUSE, status: "confirmed" }], source: "api" });
    render(await GuesthousePage());
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByLabelText(/Charges collected/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Check in" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toEqual({});
  });
});
