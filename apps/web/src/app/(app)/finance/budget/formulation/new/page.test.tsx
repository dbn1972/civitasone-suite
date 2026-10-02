import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import NewBudgetEstimatePage from "./page";

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
    expect(await screen.findByText(/only be proposed against an expenditure head/)).toBeInTheDocument();
  });
});
