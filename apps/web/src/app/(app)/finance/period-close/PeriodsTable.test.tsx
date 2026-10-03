import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PeriodsTable, type PeriodRow } from "./PeriodsTable";

const OPEN: PeriodRow = { period: "2026-05", fiscalYear: "2026-27", status: "open", closedBy: null, closedAt: null };
const SOFT: PeriodRow = {
  period: "2026-04",
  fiscalYear: "2026-27",
  status: "soft_close",
  closedBy: "11111111-1111-1111-1111-111111111111",
  closedAt: "2026-05-02T00:00:00.000Z",
};
const HARD: PeriodRow = {
  period: "2026-03",
  fiscalYear: "2026-27",
  status: "hard_close",
  closedBy: "11111111-1111-1111-1111-111111111111",
  closedAt: "2026-04-05T00:00:00.000Z",
};

const CLEAN = { unpostedVouchers: 0, unreconciledBankLines: 0, dueRecurringEntries: 0 };

/** Route the readiness GET separately from the action POST. */
function mockReadiness(readiness: unknown, actionResponse: Response = new Response(JSON.stringify({ data: {} }), { status: 202 })) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url).includes("/readiness")) {
      return readiness === "fail"
        ? new Response(null, { status: 500 })
        : new Response(JSON.stringify({ data: { period: "x", ...(readiness as object) } }), { status: 200 });
    }
    return actionResponse;
  });
}

describe("PeriodsTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders the periods list", () => {
    render(<PeriodsTable periods={[OPEN, SOFT, HARD]} canClose canHardClose canReopen />);
    expect(screen.getByText("2026-05")).toBeInTheDocument();
    expect(screen.getByText("2026-04")).toBeInTheDocument();
    expect(screen.getByText("2026-03")).toBeInTheDocument();
  });

  it("shows the guided empty state when there are no periods", () => {
    render(<PeriodsTable periods={[]} canClose canHardClose canReopen />);
    expect(screen.getByText("No periods tracked yet")).toBeInTheDocument();
  });

  it("only offers valid transitions per period status, with distinct accessible names", () => {
    render(<PeriodsTable periods={[OPEN, SOFT, HARD]} canClose canHardClose canReopen />);

    // open: soft-close + hard-close, no reopen
    expect(screen.getByRole("button", { name: "Soft-close period 2026-05" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hard-close period 2026-05" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen period 2026-05" })).not.toBeInTheDocument();

    // soft_close: hard-close + reopen, no soft-close
    expect(screen.getByRole("button", { name: "Hard-close period 2026-04" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen period 2026-04" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Soft-close period 2026-04" })).not.toBeInTheDocument();

    // hard_close: only reopen
    expect(screen.getByRole("button", { name: "Reopen period 2026-03" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Soft-close period 2026-03" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hard-close period 2026-03" })).not.toBeInTheDocument();
  });

  it("applies a hard-close on confirm (happy path)", async () => {
    mockReadiness(CLEAN, new Response(JSON.stringify({ data: { period: "2026-05", status: "hard_close" } }), { status: 200 }));

    render(<PeriodsTable periods={[OPEN]} canClose canHardClose canReopen />);
    fireEvent.click(screen.getByRole("button", { name: "Hard-close period 2026-05" }));

    await waitFor(() => expect(screen.getByText("Hard-close period 2026-05?")).toBeInTheDocument());
    await screen.findByText(/No unposted vouchers/);
    fireEvent.change(screen.getByLabelText("Reason for hard-closing"), { target: { value: "Month-end close after review" } });
    fireEvent.click(screen.getByRole("button", { name: "Hard-close" }));

    await waitFor(() => {
      expect(screen.getByText("Period 2026-05: hard-close applied.")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  // UX-016: this used to assert the raw backend `code`/`message` ("ALREADY_
  // CLOSED: period is already hard-closed") was echoed verbatim on the
  // confirm dialog -- the same class of leak useFormError/toHumanError
  // closes fleet-wide (UX-003). The clerk-safe replacement never shows
  // backend-authored text or the status code, so this now asserts a
  // catalogued message instead, and explicitly that the raw text is absent.
  it("shows a clerk-safe error on the confirm dialog when a period action fails (error path)", async () => {
    mockReadiness(CLEAN, new Response(JSON.stringify({ code: "ALREADY_CLOSED", message: "period is already hard-closed" }), {
      status: 409,
    }));

    render(<PeriodsTable periods={[SOFT]} canClose canHardClose canReopen />);
    fireEvent.click(screen.getByRole("button", { name: "Hard-close period 2026-04" }));

    await waitFor(() => expect(screen.getByText("Hard-close period 2026-04?")).toBeInTheDocument());
    await screen.findByText(/No unposted vouchers/);
    fireEvent.change(screen.getByLabelText("Reason for hard-closing"), { target: { value: "Month-end close after review" } });
    fireEvent.click(screen.getByRole("button", { name: "Hard-close" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/This period action was changed by someone else\. Refresh to see the latest version, then try again\./));
    expect(alert.textContent).not.toMatch(/ALREADY_CLOSED/);
    expect(alert.textContent).not.toMatch(/period is already hard-closed/);
  });

  it("requires a reason before allowing a reopen to be confirmed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));

    render(<PeriodsTable periods={[HARD]} canClose canHardClose canReopen />);
    fireEvent.click(screen.getByRole("button", { name: "Reopen period 2026-03" }));

    await waitFor(() => expect(screen.getByText("Reopen period 2026-03?")).toBeInTheDocument());
    const confirmBtn = screen.getByRole("button", { name: "Reopen" });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason for reopening"), { target: { value: "Correcting a posting error" } });
    expect(confirmBtn).not.toBeDisabled();
  });

  it("hides Reopen for non-admin roles (canReopen=false)", () => {
    render(<PeriodsTable periods={[SOFT, HARD]} canClose canHardClose canReopen={false} />);
    expect(screen.queryByRole("button", { name: /^Reopen/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Hard-close/ })).toBeInTheDocument();
  });

  // GAP-FINANCE-PERIOD-CLOSE-01
  it("requires a reason for soft-close and hard-close too, and POSTs it in the body", async () => {
    const fetchMock = mockReadiness(CLEAN);
    render(<PeriodsTable periods={[OPEN]} canClose canHardClose />);
    fireEvent.click(screen.getByRole("button", { name: "Soft-close period 2026-05" }));
    await waitFor(() => expect(screen.getByText("Soft-close period 2026-05?")).toBeInTheDocument());
    const confirm = screen.getByRole("button", { name: "Soft-close" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for soft-closing"), { target: { value: "Books reviewed for May" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/2026-05/close"))).toBe(true));
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/2026-05/close"))!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ reason: "Books reviewed for May" });
  });

  it("shows no close actions to a read-only finance role", () => {
    render(<PeriodsTable periods={[OPEN, SOFT, HARD]} />);
    expect(screen.queryByRole("button", { name: /Soft-close|Hard-close|Reopen/ })).not.toBeInTheDocument();
  });

  it("finance_officer tier (canClose only) gets soft-close but not hard-close", () => {
    render(<PeriodsTable periods={[OPEN]} canClose />);
    expect(screen.getByRole("button", { name: "Soft-close period 2026-05" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hard-close period 2026-05" })).not.toBeInTheDocument();
  });

  // GAP-FINANCE-PERIOD-CLOSE-02
  it("hard-close shows outstanding counts with links and requires an acknowledgement", async () => {
    mockReadiness({ unpostedVouchers: 3, unreconciledBankLines: 1, dueRecurringEntries: 0 });
    render(<PeriodsTable periods={[OPEN]} canHardClose />);
    fireEvent.click(screen.getByRole("button", { name: "Hard-close period 2026-05" }));
    const link = await screen.findByRole("link", { name: "3 unposted vouchers" });
    expect(link).toHaveAttribute("href", "/finance/journal-entry?status=draft");
    fireEvent.change(screen.getByLabelText("Reason for hard-closing"), { target: { value: "Month-end close after review" } });
    const confirm = screen.getByRole("button", { name: "Hard-close" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/reviewed these and want to hard-close anyway/));
    expect(confirm).not.toBeDisabled();
  });

  it("a readiness fetch failure shows an error and blocks hard-close", async () => {
    mockReadiness("fail");
    render(<PeriodsTable periods={[OPEN]} canHardClose />);
    fireEvent.click(screen.getByRole("button", { name: "Hard-close period 2026-05" }));
    expect(await screen.findByText(/Couldn't check outstanding items/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason for hard-closing"), { target: { value: "Month-end close after review" } });
    expect(screen.getByRole("button", { name: "Hard-close" })).toBeDisabled();
  });
});
