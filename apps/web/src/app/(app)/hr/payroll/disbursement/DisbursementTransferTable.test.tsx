import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { DisbursementTransferTable } from "./DisbursementTransferTable";
import { toClientTransferRow, type RawTransferRow } from "./transferRows";

// A legacy/defensive raw row carrying a full account number: the reducer must
// still mask it even though the real API never sends one.
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

// Exactly what GET /v1/payroll/disbursement/transfers returns
// (payroll-service disbursement-transfers/routes.ts serializeTransfer).
const API_ROW = {
  id: "11111111-2222-4333-8444-555555555555",
  runId: "aaaaaaaa-2222-4333-8444-555555555555",
  employeeId: "9b2f6c1e-0000-4000-8000-000000000002",
  employeeNo: "EMP-002",
  employeeName: "Vikram Singh",
  accountNumberMasked: "XXXX5544",
  ifsc: "HDFC0000123",
  amountPaise: "6100000",
  amountRupees: 61000,
  status: "returned",
  fileFormat: "nach",
  fileReference: "NACH_SBIN_1_20260930.txt",
  nachBatchId: "NACH_SBIN_1_20260930.txt",
  failureReason: "Account closed",
  reasonCode: "01",
  attemptNo: 1,
  parentTransferId: null,
  sentAt: "2026-09-30T10:00:00.000Z",
  settledAt: "2026-10-01T10:00:00.000Z",
  createdAt: "2026-09-30T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
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

  it("[DISB-01] takes the last 4 digits of an already-masked value like ••••1234", () => {
    expect(toClientTransferRow({ ...RAW, accountNumber: undefined, accountNumberMasked: "••••1234" }).accountLast4).toBe("1234");
    expect(toClientTransferRow({ ...RAW, accountNumber: null, accountNumberMasked: "XXXX-5678" }).accountLast4).toBe("5678");
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
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { id: "tx-2", status: "pending", parentTransferId: "tx-1", correlationId: "c-1" } }), { status: 202 }));
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

  // ── GAP-PAYROLL-DISBURSEMENT-TRANSFERS: the real API's row + statuses ────
  it("[TRANSFERS] reduces a real API row: last 4 from the server mask, exact rupees from amountPaise, NACH batch id", () => {
    const row = toClientTransferRow(API_ROW);
    expect(row).toEqual({
      id: API_ROW.id, employeeName: "Vikram Singh", accountLast4: "5544", ifsc: "HDFC0000123",
      amountMinor: "6100000", status: "returned", nachBatchId: "NACH_SBIN_1_20260930.txt", failureReason: "Account closed",
    });
    expect(JSON.stringify(row)).not.toContain(API_ROW.employeeId);
  });

  it("[TRANSFERS] a RETURNED row is retryable and shows its return reason; sent/success/pending rows are not", () => {
    renderTable([
      API_ROW,
      { ...API_ROW, id: "s1", employeeName: "Sent Person", status: "sent", failureReason: null },
      { ...API_ROW, id: "s2", employeeName: "Paid Person", status: "success", failureReason: null },
      { ...API_ROW, id: "s3", employeeName: "Queued Person", status: "pending", failureReason: null },
    ]);
    expect(screen.getByRole("button", { name: "Retry transfer for Vikram Singh" })).toBeInTheDocument();
    expect(screen.getByText("Account closed")).toBeInTheDocument();
    for (const name of ["Sent Person", "Paid Person", "Queued Person"]) {
      expect(screen.queryByRole("button", { name: `Retry transfer for ${name}` })).not.toBeInTheDocument();
    }
  });

  it("[TRANSFERS] stats count success as credited, failed+returned as failed, pending+sent as processing", () => {
    renderTable([
      { ...API_ROW, id: "a", status: "success" },
      { ...API_ROW, id: "b", status: "returned" },
      { ...API_ROW, id: "c", status: "failed" },
      { ...API_ROW, id: "d", status: "sent" },
      { ...API_ROW, id: "e", status: "pending" },
    ]);
    // The stat tiles label with <p>; the status pills also say e.g. "Failed".
    const stat = (label: string) => screen.getAllByText(label).find((el) => el.tagName === "P")!.parentElement;
    expect(stat("Credited")).toHaveTextContent("1");
    expect(stat("Failed")).toHaveTextContent("2");
    expect(stat("Processing")).toHaveTextContent("2");
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
