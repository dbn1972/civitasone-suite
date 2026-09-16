import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import NewBudgetEstimatePage from "./page";

const ACCOUNTS = [{ id: "acc-1", code: "2110", name: "Sundry Creditors" }];

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
});
