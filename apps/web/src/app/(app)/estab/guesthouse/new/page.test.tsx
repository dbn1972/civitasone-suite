import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import NewGuesthouseBookingPage from "./page";

const ROOM_ID = "11111111-1111-1111-1111-111111111111";

describe("NewGuesthouseBookingPage — booking create (L1/L2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs the booking with ISO datetimes on a valid submit", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "bk1" }), { status: 202 }));

    render(<NewGuesthouseBookingPage />);

    fireEvent.change(screen.getByLabelText(/Room ID/), { target: { value: ROOM_ID } });
    fireEvent.change(screen.getByLabelText(/Guest name/), { target: { value: "Shri A. Kumar" } });
    fireEvent.change(screen.getByLabelText(/Check-in/), { target: { value: "2026-09-01T10:00" } });
    fireEvent.change(screen.getByLabelText(/Check-out/), { target: { value: "2026-09-03T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create booking" }));

    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => typeof c[0] === "string" && (c[0] as string).includes("/estab/room-bookings"));
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.roomId).toBe(ROOM_ID);
      expect(body.guestName).toBe("Shri A. Kumar");
      // datetimes must be full ISO strings (the z.datetime() server contract).
      expect(body.checkIn).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(body.checkOut).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    });
  });

  it("rejects an invalid Room ID without calling the API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<NewGuesthouseBookingPage />);

    fireEvent.change(screen.getByLabelText(/Room ID/), { target: { value: "not-a-uuid" } });
    fireEvent.change(screen.getByLabelText(/Guest name/), { target: { value: "Shri A. Kumar" } });
    fireEvent.change(screen.getByLabelText(/Check-in/), { target: { value: "2026-09-01T10:00" } });
    fireEvent.change(screen.getByLabelText(/Check-out/), { target: { value: "2026-09-03T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create booking" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
