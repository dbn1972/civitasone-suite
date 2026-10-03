import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }) }));

import { PayrollRunActions } from "./PayrollRunActions";

const PROPS = {
  runId: "r1",
  status: "processing",
  employeeCount: 50,
  grossAmount: 500000,
  netAmount: 450000,
  payPeriod: "2026-09",
  canAdminister: true,
};

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
