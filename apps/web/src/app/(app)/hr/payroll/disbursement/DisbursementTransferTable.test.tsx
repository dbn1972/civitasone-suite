import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { DisbursementTransferTable, toClientTransferRow, type RawTransferRow } from "./DisbursementTransferTable";

const RAW: RawTransferRow = {
  id: "tx-1",
  employeeId: "9b2f6c1e-0000-4000-8000-000000000001",
  employeeName: "Asha Rao",
  accountNumber: "123456789012",
  ifsc: "SBIN0001234",
  amountRupees: 45231.5,
  status: "failed",
  nachBatchId: null,
  failureReason: "Account closed",
};

function renderTable(rows: RawTransferRow[] = [RAW]) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DisbursementTransferTable transfers={rows.map(toClientTransferRow)} />
    </NextIntlClientProvider>,
  );
}

describe("DisbursementTransferTable", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  // ── GAP-PAYROLL-DISBURSEMENT-01 ──────────────────────────────────────────
  it("[DISB-01] toClientTransferRow keeps only the last 4 digits and drops the employee UUID", () => {
    const row = toClientTransferRow(RAW);
    expect(row.accountLast4).toBe("9012");
    expect(JSON.stringify(row)).not.toContain("123456789012");
    expect(JSON.stringify(row)).not.toContain(RAW.employeeId);
  });

  it("[DISB-01] prefers a server-masked field when the API provides one", () => {
    const row = toClientTransferRow({ ...RAW, accountNumber: undefined, accountNumberMasked: "XXXXXXXX7788" });
    expect(row.accountLast4).toBe("7788");
  });

  it("[DISB-01] renders '••••9012' with no full account number or employee UUID in the DOM", () => {
    renderTable();
    expect(screen.getByText("••••9012")).toBeInTheDocument();
    expect(screen.getByLabelText("Account ending 9012")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("123456789012");
    expect(document.body.innerHTML).not.toContain(RAW.employeeId as string);
  });

  // ── GAP-PAYROLL-DISBURSEMENT-07 ──────────────────────────────────────────
  it("[DISB-07] retry confirm stays disabled until a >=10 char reason, then POSTs reason + idempotency key", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { id: "tx-1", status: "processing" } }), { status: 200 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Retry transfer for Asha Rao" }));

    const confirm = screen.getByRole("button", { name: "Retry transfer" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Reason for retry/), { target: { value: "short" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Reason for retry/), { target: { value: "Bank confirmed return R03, account updated" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/payroll/disbursement/transfers/tx-1/retry");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "Bank confirmed return R03, account updated" });
    const headers = init.headers as Record<string, string>;
    expect(headers["x-idempotency-key"]).toMatch(/.{8,}/);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("[DISB-07] the retry confirm warns about double payment and shows the amount, not a UUID", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Retry transfer for Asha Rao" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("₹45,231.50");
    expect(dialog).toHaveTextContent(/can pay twice/);
    expect(dialog.textContent).not.toContain(RAW.employeeId as string);
  });
});
