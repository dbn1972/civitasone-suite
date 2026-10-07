import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import NewGuesthouseBookingPage from "./page";
import { istLocalToUtcIso } from "./istLocal";

const ROOM_ID = "11111111-1111-1111-1111-111111111111";

describe("NewGuesthouseBookingPage — booking create (L1/L2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs the booking with ISO datetimes on a valid submit", async () => {
    const postCalls: unknown[][] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST") { postCalls.push([url, init]); return Promise.resolve(new Response(JSON.stringify({ id: "bk1" }), { status: 202 })); }
      if (url.includes("/estab/rooms")) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      if (url.includes("/estab/operators")) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });

    render(<NewGuesthouseBookingPage />);

    fireEvent.change(screen.getByLabelText(/Room\b/), { target: { value: ROOM_ID } });
    fireEvent.change(screen.getByLabelText(/Guest name/), { target: { value: "Shri A. Kumar" } });
    fireEvent.change(screen.getByLabelText(/Check-in/), { target: { value: "2026-09-01T10:00" } });
    fireEvent.change(screen.getByLabelText(/Check-out/), { target: { value: "2026-09-03T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create booking" }));

    await waitFor(() => {
      const call = postCalls.find((c) => String(c[0]).includes("/estab/room-bookings"));
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.roomId).toBe(ROOM_ID);
      expect(body.guestName).toBe("Shri A. Kumar");
      // datetimes must be full ISO strings (the z.datetime() server contract).
      expect(body.checkIn).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(body.checkOut).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    });
  });

  it("rejects an empty Room selection without calling the API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<NewGuesthouseBookingPage />);

    // Leave the room blank.
    fireEvent.change(screen.getByLabelText(/Guest name/), { target: { value: "Shri A. Kumar" } });
    fireEvent.change(screen.getByLabelText(/Check-in/), { target: { value: "2026-09-01T10:00" } });
    fireEvent.change(screen.getByLabelText(/Check-out/), { target: { value: "2026-09-03T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create booking" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/room-bookings"))).toBe(false);
  });

  it("shows a clerk-safe message, never the raw backend text, when the booking POST fails (UX-016)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST") return Promise.resolve(new Response("room already booked for that window", { status: 409 }));
      if (url.includes("/estab/rooms")) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      if (url.includes("/estab/operators")) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });

    render(<NewGuesthouseBookingPage />);

    fireEvent.change(screen.getByLabelText(/Room\b/), { target: { value: ROOM_ID } });
    fireEvent.change(screen.getByLabelText(/Guest name/), { target: { value: "Shri A. Kumar" } });
    fireEvent.change(screen.getByLabelText(/Check-in/), { target: { value: "2026-09-01T10:00" } });
    fireEvent.change(screen.getByLabelText(/Check-out/), { target: { value: "2026-09-03T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create booking" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/This booking was changed by someone else\. Refresh to see the latest version, then try again\./));
    expect(screen.getByRole("alert").textContent).not.toMatch(/room already booked/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/\b409\b/);
  });
});

describe("NewGuesthouseBookingPage — GUESTHOUSE-NEW-03/04/05", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("NEW-05: istLocalToUtcIso serialises a local time as IST regardless of host TZ", () => {
    expect(istLocalToUtcIso("2026-10-01T14:00")).toBe("2026-10-01T08:30:00.000Z");
    expect(istLocalToUtcIso("2026-01-01T00:00")).toBe("2025-12-31T18:30:00.000Z");
    expect(istLocalToUtcIso("garbage")).toBeNull();
  });

  it("NEW-04: a double click fires exactly one POST", async () => {
    const postCalls: unknown[][] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST") { postCalls.push([url, init]); return Promise.resolve(new Response(JSON.stringify({ id: "bk1" }), { status: 202 })); }
      if (url.includes("/estab/rooms")) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      if (url.includes("/estab/operators")) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });

    render(<NewGuesthouseBookingPage />);
    fireEvent.change(screen.getByLabelText(/Room\b/), { target: { value: ROOM_ID } });
    fireEvent.change(screen.getByLabelText(/Guest name/), { target: { value: "Shri A. Kumar" } });
    fireEvent.change(screen.getByLabelText(/Check-in/), { target: { value: "2026-09-01T10:00" } });
    fireEvent.change(screen.getByLabelText(/Check-out/), { target: { value: "2026-09-03T10:00" } });
    const btn = screen.getByRole("button", { name: "Create booking" });
    fireEvent.click(btn);
    fireEvent.click(btn);

    await waitFor(() =>
      expect(postCalls.filter((c) => String(c[0]).includes("/room-bookings")).length).toBe(1),
    );
  });

  it("NEW-03: reversed dates and missing name show per-field errors and focus the first invalid field", async () => {
    render(<NewGuesthouseBookingPage />);
    fireEvent.change(screen.getByLabelText(/Room\b/), { target: { value: ROOM_ID } });
    // leave guest name blank
    fireEvent.change(screen.getByLabelText(/Check-in/), { target: { value: "2026-09-05T10:00" } });
    fireEvent.change(screen.getByLabelText(/Check-out/), { target: { value: "2026-09-03T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create booking" }));

    expect(await screen.findByText("Guest name is required.")).toBeInTheDocument();
    expect(screen.getByText("Check-out must be after check-in.")).toBeInTheDocument();
    // Focus lands on the first invalid field (guest name, since room is valid).
    expect(screen.getByLabelText(/Guest name/)).toHaveFocus();
  });
});

describe("NewGuesthouseBookingPage — GUESTHOUSE-NEW-01/02 (pickers)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("NEW-01: renders a Room picker populated from the rooms directory (no raw UUID typing)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/estab/rooms")) {
        return Promise.resolve(new Response(JSON.stringify({ data: [
          { id: ROOM_ID, roomNo: "101", type: "deluxe", capacity: 2, status: "available" },
        ] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });

    render(<NewGuesthouseBookingPage />);
    // Room field becomes a <select> listing "101 · deluxe".
    await waitFor(() => {
      const roomField = screen.getByLabelText(/Room\b/);
      expect(roomField.tagName).toBe("SELECT");
      expect(roomField.textContent).toContain("101");
      expect(roomField.textContent).toContain("deluxe");
    });
  });

  it("NEW-02: selecting a staff member auto-fills the guest name", async () => {
    const STAFF_ID = "22222222-2222-2222-2222-222222222222";
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/estab/operators")) {
        return Promise.resolve(new Response(JSON.stringify({ data: [
          { employeeId: STAFF_ID, employeeName: "Asha Rao", division: "Admin" },
        ] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });

    render(<NewGuesthouseBookingPage />);
    await waitFor(() => {
      const guestRefField = screen.getByLabelText(/Guest employee ref/);
      expect(guestRefField.tagName).toBe("SELECT");
    });

    fireEvent.change(screen.getByLabelText(/Guest employee ref/), { target: { value: STAFF_ID } });
    // Guest name auto-filled from the staff selection.
    await waitFor(() => expect((screen.getByLabelText(/Guest name/) as HTMLInputElement).value).toBe("Asha Rao"));
  });
});
