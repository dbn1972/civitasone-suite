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
