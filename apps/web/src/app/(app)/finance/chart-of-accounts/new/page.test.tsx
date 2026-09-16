import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import MapHeadOfAccountPage from "./page";

const ACCOUNTS = [{ id: "acc-1", code: "2110", name: "Sundry Creditors" }];

describe("MapHeadOfAccountPage", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  // UX-016: the shared `parseErrorMessage` helper used to build the message
  // from the backend's own `message`/`error` field, or (when the body wasn't
  // JSON) the RAW response text verbatim, falling back to a literal
  // `Request failed (${res.status})` -- the same class of leak
  // useFormError/toHumanError closes fleet-wide (UX-003). This suite proves
  // all three independent flows on this page (load, create, map) are fixed.
  it("shows a clerk-safe message when the accounts load fails, never the raw status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));

    render(<MapHeadOfAccountPage />);

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't load/i));
    expect(alert.textContent).not.toMatch(/\b503\b/);
    expect(alert.textContent).not.toMatch(/failed to load/i);
  });

  it("shows a clerk-safe message when creating a head of account fails, never the raw backend text", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).includes("/finance/accounts") && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 });
      }
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ message: "duplicate_code: 2110 already exists" }), { status: 409 });
      }
      return new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 });
    });

    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2110 · Sundry Creditors").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "2111" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test Head" } });
    fireEvent.click(screen.getByRole("button", { name: /create head/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/duplicate_code/i);
    expect(alert.textContent).not.toMatch(/\b409\b/);
  });

  it("shows a clerk-safe message when mapping a HoA code fails, never the raw status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/finance/accounts") && !String(url).includes("/hoa")) {
        return new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 500 });
    });

    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2110 · Sundry Creditors").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText("Head of account"), { target: { value: "acc-1" } });
    fireEvent.change(screen.getByLabelText("PFMS HoA code"), { target: { value: "123456789012345678" } });
    fireEvent.click(screen.getByRole("button", { name: /save hoa code/i }));

    // The map flow's banner is role="status" regardless of error state
    // (pre-existing, out of scope here -- this fix is about message
    // content, not the ARIA role).
    const banner = await screen.findByRole("status");
    await waitFor(() => expect(banner).toHaveTextContent(/couldn't save/i));
    expect(banner.textContent).not.toMatch(/\b500\b/);
  });
});
