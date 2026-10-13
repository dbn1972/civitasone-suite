import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { RtiActions } from "./RtiActions";

// SF-06: "Assign PIO" used to be a raw "PIO user ID (UUID)" text box.
const PIO_ID = "5a5a5a5a-0000-4000-8000-000000000001";

afterEach(() => vi.unstubAllGlobals());

async function openAssign() {
  render(<RtiActions id="rti-1" status="filed" />);
  fireEvent.click(screen.getByRole("button", { name: "Assign PIO" }));
  return screen.findByRole("combobox");
}

describe("RtiActions — Assign PIO picker", () => {
  it("lets the user pick the PIO by name and POSTs the chosen id, never a typed UUID", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response("{}", { status: 200 });
      // Real tenant directory endpoint (open to any tenant member); the
      // ADMIN-gated /identity/users list is not routed and must not be used.
      if (!String(url).startsWith("/api/proxy/v1/identity/users/directory?q=")) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ data: [{ id: PIO_ID, displayName: "Pia Officer" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const box = await openAssign();
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "Pia" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Pia Officer/ }));

    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toBe("/api/proxy/v1/hrms/rti/requests/rti-1/assign");
      expect(JSON.parse(String(post![1]!.body))).toEqual({ pioId: PIO_ID });
    });
  });

  it("shows a load error, not 'No matching users', when the user directory fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const box = await openAssign();
    fireEvent.change(box, { target: { value: "Pia" } });
    expect(await screen.findByRole("alert", {}, { timeout: 2000 })).toHaveTextContent(/could not load/i);
    expect(screen.queryByText(/no matching users/i)).not.toBeInTheDocument();
  });
});
