import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }) }));

import { PayrollRunActions } from "./PayrollRunActions";

// GAP-PAYROLL-HOME-01: integer-paise strings (Rs 5,00,000.00 gross / Rs 4,50,000.00 net).
const PROPS = {
  runId: "r1",
  status: "processing",
  employeeCount: 50,
  grossMinor: "50000000",
  netMinor: "45000000",
  payPeriod: "2026-09",
  canAdminister: true,
};

const ME = "11111111-0000-4000-8000-0000000000aa";
const OTHER = "22222222-0000-4000-8000-0000000000bb";

/**
 * UX-016: this used to show the raw backend response text (falling back to
 * `${action} failed (${res.status})`) verbatim — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("PayrollRunActions — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw server text or status, when approve fails", async () => {
    fetchMock.mockResolvedValue(new Response("payroll-service: approve trace at line 90", { status: 500 }));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PayrollRunActions {...PROPS} />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /approve run/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/approval remarks/i), { target: { value: "Reviewed and correct" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /approve run/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/payroll-service/);
    expect(dialog.textContent).not.toMatch(/\b500\b/);
  });
});

// fin-payroll-03 (GAP-PAYROLL-DETAIL-05 / 06)
describe("PayrollRunActions — pre-disbursement issues and disburse copy", () => {
  function renderActions(props: Record<string, unknown>) {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PayrollRunActions {...PROPS} {...props} />
      </NextIntlClientProvider>,
    );
  }

  it("DETAIL-05: the Approve confirmation warns when employees still have unresolved issues", async () => {
    renderActions({ exceptionCount: 3 });
    fireEvent.click(screen.getByRole("button", { name: /approve run/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("3 employees still have unresolved issues");
  });

  it("DETAIL-05: no warning when there are none", async () => {
    renderActions({ exceptionCount: 0 });
    fireEvent.click(screen.getByRole("button", { name: /approve run/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).not.toHaveTextContent("unresolved");
  });

  it("DETAIL-06: the Disburse confirmation names the real channel and what happens next, not a bare released to PFMS", async () => {
    renderActions({ status: "completed", exceptionCount: 1 });
    fireEvent.click(screen.getByRole("button", { name: /disburse/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("sends an instruction to the finance EFT / PFMS bridge");
    expect(dialog).toHaveTextContent("Disbursement page");
    expect(dialog).toHaveTextContent("irreversible");
    expect(dialog).not.toHaveTextContent("Funds are released to PFMS");
    expect(dialog).toHaveTextContent("1 employee still has an unresolved issue");
  });
});

// GAP-PAYROLL-DETAIL-02: maker-checker. The server is the authority (403
// MAKER_CHECKER_VIOLATION); the UI explains and disables instead of letting the
// maker / approver click into a guaranteed refusal.
describe("PayrollRunActions — GAP-PAYROLL-DETAIL-02 maker-checker", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderActions(props: Record<string, unknown>) {
    return render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PayrollRunActions {...PROPS} {...props} />
      </NextIntlClientProvider>,
    );
  }

  it("disables Approve with the maker-checker hint when the viewer created the run", () => {
    renderActions({ currentUserId: ME, createdBy: ME, approvedBy: null });
    const approve = screen.getByRole("button", { name: /approve run/i });
    expect(approve).toBeDisabled();
    const hint = screen.getByText("You created this run, so a different approver must approve it (maker-checker).");
    expect(hint).toBeInTheDocument();
    expect(approve).toHaveAttribute("aria-describedby", hint.id);
    fireEvent.click(approve);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps Approve enabled for a different user", () => {
    renderActions({ currentUserId: OTHER, createdBy: ME, approvedBy: null });
    expect(screen.getByRole("button", { name: /approve run/i })).toBeEnabled();
    expect(screen.queryByText(/maker-checker\)\./)).not.toBeInTheDocument();
  });

  it("does not block when the ids are unknown (older API, signed-out session): the server decides", () => {
    renderActions({ currentUserId: null, createdBy: ME, approvedBy: null });
    expect(screen.getByRole("button", { name: /approve run/i })).toBeEnabled();
    renderActions({ currentUserId: ME, createdBy: null, approvedBy: null });
    expect(screen.getAllByRole("button", { name: /approve run/i }).every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("disables Disburse with its hint when the viewer approved the run, but not for the creator or anyone else", () => {
    const { unmount } = renderActions({ status: "completed", currentUserId: ME, createdBy: OTHER, approvedBy: ME });
    expect(screen.getByRole("button", { name: /disburse run/i })).toBeDisabled();
    expect(screen.getByText("You approved this run, so a different officer must disburse it (maker-checker).")).toBeInTheDocument();
    unmount();

    renderActions({ status: "completed", currentUserId: OTHER, createdBy: OTHER, approvedBy: ME });
    expect(screen.getByRole("button", { name: /disburse run/i })).toBeEnabled();
  });

  it("the creator being the viewer does not disable Disburse (only the approver is excluded)", () => {
    renderActions({ status: "completed", currentUserId: ME, createdBy: ME, approvedBy: OTHER });
    expect(screen.getByRole("button", { name: /disburse run/i })).toBeEnabled();
  });

  it("shows the plain maker-checker sentence in the dialog when the server still answers 403 MAKER_CHECKER_VIOLATION", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "MAKER_CHECKER_VIOLATION", message: "raw server text" }), { status: 403 }));
    renderActions({ currentUserId: OTHER, createdBy: ME, approvedBy: null });
    fireEvent.click(screen.getByRole("button", { name: /approve run/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/approval remarks/i), { target: { value: "Reviewed and correct" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /approve run/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/someone other than the person who made it/i));
    expect(dialog.textContent).not.toMatch(/raw server text/);
    expect(dialog.textContent).not.toMatch(/couldn't save/i);
  });

  it("a 403 MAKER_CHECKER_VIOLATION on DISBURSE says the approver cannot disburse, not 'someone other than the person who made it'", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "MAKER_CHECKER_VIOLATION", message: "raw server text" }), { status: 403 }));
    // Reached only if the disabled-button hint was bypassed or the page state was stale.
    renderActions({ status: "completed", currentUserId: OTHER, createdBy: ME, approvedBy: ME });
    fireEvent.click(screen.getByRole("button", { name: /disburse run/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/disbursement authorisation/i), { target: { value: "Bank file checked today" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /disburse now/i }));

    await waitFor(() => expect(dialog).toHaveTextContent("You approved this run, so you cannot disburse it. Another officer needs to disburse it."));
    expect(dialog.textContent).not.toMatch(/someone other than the person who made it/i);
    expect(dialog.textContent).not.toMatch(/raw server text/);
    expect(dialog.textContent).not.toMatch(/couldn't save/i);
  });

  it("any other 403 on disburse keeps the shared wording instead of the maker-checker sentence", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN", message: "raw server text" }), { status: 403 }));
    renderActions({ status: "completed", currentUserId: OTHER, createdBy: ME, approvedBy: ME });
    fireEvent.click(screen.getByRole("button", { name: /disburse run/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/disbursement authorisation/i), { target: { value: "Bank file checked today" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /disburse now/i }));

    await waitFor(() => expect(dialog).toHaveTextContent("You don't have permission to do this."));
    expect(dialog.textContent).not.toMatch(/you cannot disburse it/i);
    expect(dialog.textContent).not.toMatch(/raw server text/);
  });

  it("the revert dialog sends the typed reason (>= 10 characters) in the PATCH body, which the server now records on the audit event", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "r1", status: "accepted" }), { status: 202 }));
    renderActions({ status: "failed" });
    fireEvent.click(screen.getByRole("button", { name: /revert to draft/i }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: /revert to draft/i });
    fireEvent.change(within(dialog).getByLabelText(/reason for revert/i), { target: { value: "too short" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/reason for revert/i), { target: { value: "Retry after the structure fix" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/payroll/runs/r1/revert");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "Retry after the structure fix" });
  });

  it("sends the typed reason in the PATCH body (>= 10 characters is enforced before it is sent)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "r1", status: "accepted" }), { status: 202 }));
    renderActions({ currentUserId: OTHER, createdBy: ME, approvedBy: null });
    fireEvent.click(screen.getByRole("button", { name: /approve run/i }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: /approve run/i });
    fireEvent.change(within(dialog).getByLabelText(/approval remarks/i), { target: { value: "too short" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/approval remarks/i), { target: { value: "Register checked" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/payroll/runs/r1/approve");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "Register checked" });
  });
});

// GAP-PAYROLL-HOME-01: the confirmation summaries render from integer paise.
describe("PayrollRunActions — GAP-PAYROLL-HOME-01 amounts come from paise", () => {
  function renderActions(props: Record<string, unknown>) {
    return render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PayrollRunActions {...PROPS} {...props} />
      </NextIntlClientProvider>,
    );
  }

  it("the Approve dialog shows the exact gross (₹5,00,000.00) from grossMinor", async () => {
    renderActions({});
    fireEvent.click(screen.getByRole("button", { name: /approve run/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("₹5,00,000.00");
    expect(dialog).not.toHaveTextContent("₹5,000.00");
  });

  it("the Disburse dialog shows the exact net (₹4,50,000.00) and the employee count", async () => {
    renderActions({ status: "completed" });
    fireEvent.click(screen.getByRole("button", { name: /disburse run/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("₹4,50,000.00");
    expect(dialog).toHaveTextContent("50");
  });

  it("an unknown amount reads as a dash, never as ₹0.00", async () => {
    renderActions({ grossMinor: undefined });
    fireEvent.click(screen.getByRole("button", { name: /approve run/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).not.toHaveTextContent("₹0.00");
    expect(dialog).toHaveTextContent("gross of —");
  });
});
