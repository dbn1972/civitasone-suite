import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import NewGuesthouseBookingPage from "./page";
import { istLocalToUtcIso } from "./istLocal";

const ROOM_ID = "11111111-1111-1111-1111-111111111111";
const ROOMS = [
  { id: ROOM_ID, roomNo: "101", type: "deluxe", capacity: 2, status: "available" },
  { id: "33333333-3333-3333-3333-333333333333", roomNo: "102", type: "standard", capacity: 1, status: "maintenance" },
];

/** Waits for the rooms directory to load, then picks Room 101 by what the clerk sees (never by typing an id). */
async function chooseRoom() {
  const select = (await screen.findByLabelText(/Room\b/)) as HTMLSelectElement;
  await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
  const option = Array.from(select.options).find((o) => o.textContent?.includes("101"));
  expect(option).toBeDefined();
  fireEvent.change(select, { target: { value: option!.value } });
}

describe("NewGuesthouseBookingPage — booking create (L1/L2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs the booking with ISO datetimes on a valid submit", async () => {
    const postCalls: unknown[][] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST") { postCalls.push([url, init]); return Promise.resolve(new Response(JSON.stringify({ id: "bk1" }), { status: 202 })); }
      if (url.includes("/estab/rooms")) return Promise.resolve(new Response(JSON.stringify({ data: ROOMS }), { status: 200 }));
      if (url.includes("/estab/operators")) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });

    render(<NewGuesthouseBookingPage />);

    await chooseRoom();
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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(new Response(JSON.stringify({ data: String(input).includes("/estab/rooms") ? ROOMS : [] }), { status: 200 })));

    render(<NewGuesthouseBookingPage />);
    await waitFor(() => expect((screen.getByLabelText(/Room\b/) as HTMLSelectElement).options.length).toBeGreaterThan(1));

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
      if (url.includes("/estab/rooms")) return Promise.resolve(new Response(JSON.stringify({ data: ROOMS }), { status: 200 }));
      if (url.includes("/estab/operators")) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });

    render(<NewGuesthouseBookingPage />);

    await chooseRoom();
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
      if (url.includes("/estab/rooms")) return Promise.resolve(new Response(JSON.stringify({ data: ROOMS }), { status: 200 }));
      if (url.includes("/estab/operators")) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });

    render(<NewGuesthouseBookingPage />);
    await chooseRoom();
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
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(new Response(JSON.stringify({ data: String(input).includes("/estab/rooms") ? ROOMS : [] }), { status: 200 })));
    render(<NewGuesthouseBookingPage />);
    await chooseRoom();
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

describe("NewGuesthouseBookingPage — GUESTHOUSE-NEW-01 (the room is chosen by name, never typed)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockRooms(rooms: unknown, status = 200, posts: unknown[][] = []) {
    return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST") { posts.push([url, init]); return Promise.resolve(new Response(JSON.stringify({ id: "bk1" }), { status: 202 })); }
      if (url.includes("/estab/rooms")) return Promise.resolve(new Response(JSON.stringify(status === 200 ? { data: rooms } : { message: "boom" }), { status }));
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    });
  }

  it("choosing 'Room 101' from the picker posts that room's id", async () => {
    const posts: unknown[][] = [];
    mockRooms(ROOMS, 200, posts);
    render(<NewGuesthouseBookingPage />);
    const select = (await screen.findByLabelText(/Room\b/)) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
    // The clerk sees names, not ids.
    expect(Array.from(select.options).map((o) => o.textContent)).toContain("101 · deluxe (2-bed)");
    expect(select.textContent).not.toContain(ROOM_ID);
    fireEvent.change(select, { target: { value: screen.getByRole("option", { name: /101 · deluxe/ }).getAttribute("value") } });
    fireEvent.change(screen.getByLabelText(/Guest name/), { target: { value: "Shri A. Kumar" } });
    fireEvent.change(screen.getByLabelText(/Check-in/), { target: { value: "2026-09-01T10:00" } });
    fireEvent.change(screen.getByLabelText(/Check-out/), { target: { value: "2026-09-03T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create booking" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(JSON.parse((posts[0]![1] as RequestInit).body as string).roomId).toBe(ROOM_ID);
  });

  it("only rooms that are available are offered", async () => {
    mockRooms(ROOMS);
    render(<NewGuesthouseBookingPage />);
    const select = (await screen.findByLabelText(/Room\b/)) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
    expect(Array.from(select.options).map((o) => o.textContent)).not.toContain("102 · standard (1-bed)");
  });

  it("with no rooms registered there is NO free-text Room ID field: a disabled picker and a plain explanation, and nothing can be posted", async () => {
    const posts: unknown[][] = [];
    mockRooms([], 200, posts);
    render(<NewGuesthouseBookingPage />);
    expect(await screen.findByText(/No rooms are registered yet/)).toBeInTheDocument();
    const room = screen.getByLabelText(/Room\b/) as HTMLSelectElement;
    expect(room.tagName).toBe("SELECT");
    expect(room.disabled).toBe(true);
    expect(screen.queryByRole("textbox", { name: /Room\b/ })).toBeNull();
    fireEvent.change(screen.getByLabelText(/Guest name/), { target: { value: "Shri A. Kumar" } });
    fireEvent.change(screen.getByLabelText(/Check-in/), { target: { value: "2026-09-01T10:00" } });
    fireEvent.change(screen.getByLabelText(/Check-out/), { target: { value: "2026-09-03T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create booking" }));
    expect(await screen.findByText("Select a room.")).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it("when every registered room is unavailable it says so, still without a typed fallback", async () => {
    mockRooms([ROOMS[1]]);
    render(<NewGuesthouseBookingPage />);
    expect(await screen.findByText(/None of the registered rooms is available/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Room\b/ })).toBeNull();
  });

  it("when the room directory fails to load it is an alert, not 'no rooms', and not a typed field", async () => {
    mockRooms(null, 500);
    render(<NewGuesthouseBookingPage />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/room list could not be loaded/i);
    expect(screen.queryByText(/No rooms are registered yet/)).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Room\b/ })).toBeNull();
  });

  it("the subtitle no longer claims the booking waits for approval (there is no approval step)", () => {
    mockRooms(ROOMS);
    render(<NewGuesthouseBookingPage />);
    expect(screen.queryByText(/pending approval/i)).toBeNull();
    expect(screen.getByText(/confirmed once it is processed/i)).toBeInTheDocument();
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

describe("NewGuesthouseBookingPage - guest picker accessibility (SF-06)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("the staff picker keeps its help text association and is not flagged invalid by default", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
    render(<NewGuesthouseBookingPage />);
    const picker = await screen.findByRole("combobox", { name: /Guest employee ref/ });
    expect(picker).toHaveAttribute("aria-describedby", "guestRef-help");
    expect(picker).not.toHaveAttribute("aria-invalid", "true");
  });
});
