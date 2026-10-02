import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import NewBudgetEstimatePage from "./page";

/** GAP-FINANCE-BUDGET-FORMULATION-NEW-03: submitting the form only opens the confirm dialog; this confirms it. */
function confirmDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Confirm and submit" }));
}

const ACCOUNTS = [{ id: "acc-1", code: "2110", name: "Sundry Creditors" }];
// Typed rows as GET /v1/finance/accounts returns them (`type` = accounting nature).
const TYPED_ACCOUNTS = [
  { id: "acc-exp", code: "3054", name: "Roads and Bridges", type: "expense" },
  { id: "acc-liab", code: "8443", name: "Civil Deposits", type: "liability" },
  { id: "acc-bank", code: "8670", name: "Cheques and Bills", type: "asset" },
];

describe("NewBudgetEstimatePage", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    pushMock.mockReset();
    vi.restoreAllMocks();
  });

  it("loads budget heads and submits a new estimate (happy path)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/finance/accounts")) {
        return new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 202 });
    });

    render(<NewBudgetEstimatePage />);
    await waitFor(() => expect(screen.getByText("2110 · Sundry Creditors")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Budget head"), { target: { value: "acc-1" } });
    fireEvent.change(screen.getByLabelText("Budget estimate (₹)"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /submit estimate/i }));
    confirmDialog();

    await waitFor(() => expect(screen.getByText("Budget estimate submitted.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/finance/budgets",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // UX-016: the load-failure branch used to throw `Failed to load budget
  // heads (${res.status})` (a raw HTTP status leak, UX-003), and the submit
  // failure branch used to `throw new Error(await res.text())` -- echoing
  // the raw, unparsed response body verbatim. Proves both are fixed: neither
  // path ever shows the raw status or raw body text.
  it("shows a clerk-safe message when loading budget heads fails, never the raw status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));

    render(<NewBudgetEstimatePage />);

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't load/i));
    expect(alert.textContent).not.toMatch(/\b503\b/);
    expect(alert.textContent).not.toMatch(/failed to load/i);
  });

  // Regression: the initial-load fetch() (and its `if (!res.ok)` branch) had
  // been moved outside the try block during the UX-016 raw-status-leak fix,
  // so a REJECTED fetch promise (offline, DNS failure, CORS -- as opposed to
  // a resolved non-2xx Response) escaped as an unhandled rejection inside the
  // detached async IIFE instead of being caught and routed through
  // fromException. Proves the fetch (and its ok-check) are back inside the
  // try, same as every other file in this PR.
  it("shows a clerk-safe message when the initial fetch itself rejects (network failure), never hangs or crashes", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<NewBudgetEstimatePage />);

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/check your internet connection/i));
    expect(alert.textContent).not.toMatch(/TypeError/);
    expect(alert.textContent).not.toMatch(/Failed to fetch/);
  });

  it("shows a clerk-safe message when submitting fails, never the raw response body", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/finance/accounts")) {
        return new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 });
      }
      return new Response("Internal server error: NPE at BudgetService.java:42", { status: 500 });
    });

    render(<NewBudgetEstimatePage />);
    await waitFor(() => expect(screen.getByText("2110 · Sundry Creditors")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Budget head"), { target: { value: "acc-1" } });
    fireEvent.change(screen.getByLabelText("Budget estimate (₹)"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /submit estimate/i }));
    confirmDialog();

    // This file's submit-failure banner is role="status" (isError only
    // changes its background color, not the ARIA role) -- pre-existing and
    // out of scope for this fix, which is about the message content, not
    // the role.
    const banner = await screen.findByRole("status");
    await waitFor(() => expect(banner).toHaveTextContent(/couldn't save/i));
    expect(banner.textContent).not.toMatch(/NPE/);
    expect(banner.textContent).not.toMatch(/BudgetService/);
    expect(banner.textContent).not.toMatch(/\b500\b/);
  });

  // GAP-FINANCE-BUDGET-FORMULATION-NEW-01: exact, string-based paise.
  async function submitAmount(value: string) {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/finance/accounts")) {
        return new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 202 });
    });
    render(<NewBudgetEstimatePage />);
    await waitFor(() => expect(screen.getByText("2110 · Sundry Creditors")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Budget head"), { target: { value: "acc-1" } });
    fireEvent.change(screen.getByLabelText("Budget estimate (₹)"), { target: { value } });
    fireEvent.submit(screen.getByRole("button", { name: /submit estimate/i }).closest("form")!);
    // A valid amount opens the confirm dialog; an invalid one never does.
    if (screen.queryByRole("button", { name: "Confirm and submit" })) confirmDialog();
    return fetchMock;
  }
  const budgetPosts = (m: { mock: { calls: unknown[][] } }) =>
    m.mock.calls.filter(([u]) => String(u).endsWith("/finance/budgets"));

  it("POSTs beMinor as the exact paise string for 1234567.89", async () => {
    const m = await submitAmount("1234567.89");
    await waitFor(() => expect(budgetPosts(m).length).toBe(1));
    expect(JSON.parse(String((budgetPosts(m)[0][1] as RequestInit).body)).beMinor).toBe("123456789");
  });

  it("keeps precision above 2^53 paise (90071992547409.93 -> 9007199254740993)", async () => {
    const m = await submitAmount("90071992547409.93");
    await waitFor(() => expect(budgetPosts(m).length).toBe(1));
    expect(JSON.parse(String((budgetPosts(m)[0][1] as RequestInit).body)).beMinor).toBe("9007199254740993");
  });

  for (const bad of ["1.005", "-5", "0", "abc", "1e21"]) {
    it(`blocks ${bad} with an inline error and never calls the budgets endpoint`, async () => {
      const m = await submitAmount(bad);
      expect(await screen.findByText(/at most 2 decimals/)).toBeInTheDocument();
      expect(budgetPosts(m).length).toBe(0);
    });
  }

  // GAP-FINANCE-BUDGET-FORMULATION-NEW-02
  it("offers only expenditure heads in the picker", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: TYPED_ACCOUNTS }), { status: 200 }));
    render(<NewBudgetEstimatePage />);
    await waitFor(() => expect(screen.getByText("3054 · Roads and Bridges")).toBeInTheDocument());
    expect(screen.queryByText("8443 · Civil Deposits")).not.toBeInTheDocument();
    expect(screen.queryByText("8670 · Cheques and Bills")).not.toBeInTheDocument();
  });

  it("shows the server's headId field error under the head picker", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/finance/accounts")) {
        return new Response(JSON.stringify({ data: TYPED_ACCOUNTS }), { status: 200 });
      }
      return new Response(JSON.stringify({
        code: "VALIDATION_FAILED", message: "invalid request",
        fieldErrors: [{ field: "headId", message: "a budget estimate can only be proposed against an expenditure head" }],
      }), { status: 400 });
    });
    render(<NewBudgetEstimatePage />);
    await waitFor(() => expect(screen.getByText("3054 · Roads and Bridges")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Budget head"), { target: { value: "acc-exp" } });
    fireEvent.change(screen.getByLabelText("Budget estimate (₹)"), { target: { value: "10" } });
    fireEvent.submit(screen.getByRole("button", { name: /submit estimate/i }).closest("form")!);
    confirmDialog();
    expect(await screen.findByText(/only be proposed against an expenditure head/)).toBeInTheDocument();
  });
});

describe("NewBudgetEstimatePage -- confirm, idempotency, FY, heads list (NEW-03/04/05/06)", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    pushMock.mockReset();
    vi.restoreAllMocks();
  });

  function mockFetch(accounts: unknown[] = ACCOUNTS, budgetsResponse: () => Response = () => new Response("{}", { status: 202 })) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/finance/accounts")) return new Response(JSON.stringify({ data: accounts }), { status: 200 });
      return budgetsResponse();
    });
  }
  const posts = (m: { mock: { calls: unknown[][] } }) => m.mock.calls.filter(([u]) => String(u).endsWith("/finance/budgets"));
  async function fill(amount = "1000", fy?: string) {
    await waitFor(() => expect(screen.getByText("2110 · Sundry Creditors")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Budget head"), { target: { value: "acc-1" } });
    fireEvent.change(screen.getByLabelText("Budget estimate (₹)"), { target: { value: amount } });
    if (fy) fireEvent.change(screen.getByLabelText("Financial year"), { target: { value: fy } });
  }

  it("Submit opens a confirm dialog naming the amount, head and FY, and issues NO request", async () => {
    const m = mockFetch();
    render(<NewBudgetEstimatePage />);
    await fill("1234.50", "2026-27");
    fireEvent.click(screen.getByRole("button", { name: /submit estimate/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("₹1,234.50");
    expect(dialog).toHaveTextContent("2110 · Sundry Creditors");
    expect(dialog).toHaveTextContent("FY 2026-27");
    expect(posts(m).length).toBe(0);
  });

  it("Cancel closes the dialog with no request", async () => {
    const m = mockFetch();
    render(<NewBudgetEstimatePage />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /submit estimate/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(posts(m).length).toBe(0);
  });

  it("confirming issues exactly one POST carrying an x-idempotency-key", async () => {
    const m = mockFetch();
    render(<NewBudgetEstimatePage />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /submit estimate/i }));
    confirmDialog();
    await waitFor(() => expect(posts(m).length).toBe(1));
    const headers = (posts(m)[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a failed save keeps the same idempotency key for the retry; a successful one rotates it", async () => {
    let ok = false;
    const m = mockFetch(ACCOUNTS, () => (ok ? new Response("{}", { status: 202 }) : new Response("", { status: 503 })));
    render(<NewBudgetEstimatePage />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /submit estimate/i }));
    confirmDialog();
    await waitFor(() => expect(posts(m).length).toBe(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /submit estimate/i })).not.toBeDisabled());
    ok = true;
    fireEvent.click(screen.getByRole("button", { name: /submit estimate/i }));
    confirmDialog();
    await waitFor(() => expect(posts(m).length).toBe(2));
    const key = (i: number) => ((posts(m)[i][1] as RequestInit).headers as Record<string, string>)["x-idempotency-key"];
    expect(key(1)).toBe(key(0)); // retry of the same proposal -> same key
    await waitFor(() => expect(screen.getByText("Budget estimate submitted.")).toBeInTheDocument());
    // Next proposal after success uses a fresh key.
    fireEvent.change(screen.getByLabelText("Budget estimate (₹)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /submit estimate/i }));
    confirmDialog();
    await waitFor(() => expect(posts(m).length).toBe(3));
    expect(key(2)).not.toBe(key(1));
  });

  it("editing the amount (or head/FY) after a failure rotates the idempotency key", async () => {
    const m = mockFetch(ACCOUNTS, () => new Response("", { status: 503 }));
    render(<NewBudgetEstimatePage />);
    await fill();
    const key = (i: number) => ((posts(m)[i][1] as RequestInit).headers as Record<string, string>)["x-idempotency-key"];
    fireEvent.click(screen.getByRole("button", { name: /submit estimate/i }));
    confirmDialog();
    await waitFor(() => expect(posts(m).length).toBe(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /submit estimate/i })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Budget estimate (₹)"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: /submit estimate/i }));
    confirmDialog();
    await waitFor(() => expect(posts(m).length).toBe(2));
    expect(key(1)).not.toBe(key(0));
    await waitFor(() => expect(screen.getByRole("button", { name: /submit estimate/i })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Financial year"), { target: { value: "2027-28" } });
    fireEvent.click(screen.getByRole("button", { name: /submit estimate/i }));
    confirmDialog();
    await waitFor(() => expect(posts(m).length).toBe(3));
    expect(key(2)).not.toBe(key(1));
  });

  it("success message stays up (no immediate redirect) and links to the new estimate's FY list", async () => {
    mockFetch();
    render(<NewBudgetEstimatePage />);
    await fill("10", "2027-28");
    fireEvent.click(screen.getByRole("button", { name: /submit estimate/i }));
    confirmDialog();
    const link = await screen.findByRole("link", { name: "View in Budget Formulation" });
    expect(link).toHaveAttribute("href", "/finance/budget/formulation?fy=2027-28");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed FY (2026-28) with an inline error and no dialog/request", async () => {
    const m = mockFetch();
    render(<NewBudgetEstimatePage />);
    await fill("10", "2026-28");
    fireEvent.submit(screen.getByRole("button", { name: /submit estimate/i }).closest("form")!);
    expect(await screen.findByText(/valid financial year/i)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(posts(m).length).toBe(0);
  });

  it("defaults the FY to the IST financial year (1 Apr 2027 IST -> 2027-28)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-31T19:00:00Z"));
    try {
      mockFetch();
      render(<NewBudgetEstimatePage />);
      expect((screen.getByLabelText("Financial year") as HTMLInputElement).value).toBe("2027-28");
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables the head select with a loading option while the heads fetch is pending", async () => {
    let release!: () => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>((res) => {
      release = () => res(new Response(JSON.stringify({ data: ACCOUNTS }), { status: 200 }));
    }));
    render(<NewBudgetEstimatePage />);
    const select = screen.getByLabelText("Budget head");
    expect(select).toBeDisabled();
    expect(screen.getByText("Loading heads…")).toBeInTheDocument();
    release();
    await waitFor(() => expect(select).not.toBeDisabled());
  });

  it("shows a truncation hint when the heads response is full, not otherwise", async () => {
    const full = Array.from({ length: 500 }, (_, i) => ({ id: `a${i}`, code: String(2000 + i), name: `Head ${i}`, type: "expense" }));
    mockFetch(full);
    const { unmount } = render(<NewBudgetEstimatePage />);
    expect(await screen.findByRole("note")).toHaveTextContent(/first 500 heads/i);
    unmount();
    vi.restoreAllMocks();
    mockFetch(ACCOUNTS);
    render(<NewBudgetEstimatePage />);
    await waitFor(() => expect(screen.getByText("2110 · Sundry Creditors")).toBeInTheDocument());
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
