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

  // Regression: loadAccounts' fetch() (and its `if (!res.ok)` branch) had
  // been moved outside the try block during the UX-016 raw-status-leak fix.
  // loadAccounts is invoked as `void loadAccounts()` from the mount effect,
  // so a REJECTED fetch promise (offline, DNS failure, CORS -- as opposed to
  // a resolved non-2xx Response) escaped as an unhandled rejection instead of
  // being caught and routed through fromException. Proves the fetch (and its
  // ok-check) are back inside the try, same as every other file in this PR.
  it("shows a clerk-safe message when the initial accounts fetch itself rejects (network failure), never hangs or crashes", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<MapHeadOfAccountPage />);

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/check your internet connection/i));
    expect(alert.textContent).not.toMatch(/TypeError/);
    expect(alert.textContent).not.toMatch(/Failed to fetch/);
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
    // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-01: saving now goes through a confirm dialog with a reason.
    fireEvent.change(await screen.findByLabelText("Reason for changing PFMS HoA code"), { target: { value: "Aligning with PFMS mapping" } });
    fireEvent.click(screen.getByRole("button", { name: "Change HoA code" }));

    // The map flow's banner is role="status" regardless of error state
    // (pre-existing, out of scope here -- this fix is about message
    // content, not the ARIA role).
    const banner = await screen.findByRole("status");
    await waitFor(() => expect(banner).toHaveTextContent(/couldn't save/i));
    expect(banner.textContent).not.toMatch(/\b500\b/);
  });

  // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-01
  it("shows the head's current HoA code and sends the old->new change with a reason only after confirmation", async () => {
    const OLD = "210100101010101010";
    const NEW = "123456789012345678";
    const calls: { url: string; method?: string; body?: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body as string | undefined });
      if (init?.method === "PATCH") return new Response(JSON.stringify({ status: "updated" }), { status: 200 });
      return new Response(JSON.stringify({ data: [{ id: "acc-1", code: "2110", name: "Sundry Creditors", level: 0, hoaCode: OLD }] }), { status: 200 });
    });

    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2110 · Sundry Creditors").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Head of account"), { target: { value: "acc-1" } });
    expect(screen.getByText(OLD)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("PFMS HoA code"), { target: { value: NEW } });
    fireEvent.click(screen.getByRole("button", { name: /save hoa code/i }));

    // Nothing is sent until the dialog is confirmed with a reason.
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    const confirm = await screen.findByRole("button", { name: "Change HoA code" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for changing PFMS HoA code"), { target: { value: "Aligning with PFMS mapping" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(JSON.parse(patch.body!)).toEqual({ hoaCode: NEW, reason: "Aligning with PFMS mapping" });
  });

  // GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-02
  it("requires a parent head for a minor head and sends parentId", async () => {
    const posts: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        posts.push(init.body as string);
        return new Response(JSON.stringify({ id: "new" }), { status: 201 });
      }
      return new Response(JSON.stringify({ data: [
        { id: "maj-1", code: "2000", name: "Liabilities", level: 0 },
        { id: "min-1", code: "2100", name: "Creditors", level: 1 },
      ] }), { status: 200 });
    });

    render(<MapHeadOfAccountPage />);
    await waitFor(() => expect(screen.getAllByText("2000 · Liabilities").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "2101" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Trade Creditors" } });
    // Major level: no parent field.
    expect(screen.queryByLabelText("Parent head")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "1" } });
    const parent = screen.getByLabelText("Parent head");
    // Only heads exactly one level up are offered as a parent.
    expect(screen.getAllByText("2000 · Liabilities").length).toBeGreaterThan(0);
    expect(parent.querySelectorAll("option").length).toBe(2); // placeholder + the one major head
    expect(screen.getByRole("button", { name: /create head/i })).toBeDisabled();

    fireEvent.change(parent, { target: { value: "maj-1" } });
    fireEvent.click(screen.getByRole("button", { name: /create head/i }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(JSON.parse(posts[0]!)).toMatchObject({ code: "2101", level: 1, parentId: "maj-1" });
  });
});
