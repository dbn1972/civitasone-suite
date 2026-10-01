import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { BankFileWizard, type DscStatus, type RunOption, type FormatAvailability } from "./BankFileWizard";

const RUN: RunOption = { id: "r1", payPeriod: "2026-09", netAmountRupees: 450000, employeeCount: 37, status: "completed" };
const PAID_RUN: RunOption = { ...RUN, id: "r2", status: "paid" };
const REASON = "September salary NEFT batch for SBI";

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function renderWizard(
  runs: RunOption[] = [RUN],
  dsc: DscStatus = { kind: "none" },
  availability?: FormatAvailability,
) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <BankFileWizard runs={runs} dsc={dsc} availability={availability} />
    </NextIntlClientProvider>,
  );
}

function goToDownloadStep() {
  fireEvent.click(screen.getByRole("button", { name: /next: preview/i }));
  fireEvent.click(screen.getByRole("button", { name: /next: dsc/i }));
  fireEvent.click(screen.getByRole("button", { name: /next: download/i }));
}

function okFile(headers: Record<string, string> = {}) {
  return new Response("Employee No,Name\r\n", {
    status: 200,
    headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="bank_transfer_RUN1_2026-09.csv"', ...headers },
  });
}

describe("BankFileWizard", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // jsdom has no object URLs.
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => vi.unstubAllGlobals());

  // ── UX-016 (kept) ────────────────────────────────────────────────────────
  it("shows a clerk-safe message, never the raw backend error code, when generation fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "PFMS_TIMEOUT", message: "PFMS gateway timeout at retry 3" } }), {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
    );
    renderWizard();
    goToDownloadStep();
    fireEvent.click(screen.getByRole("button", { name: /download bank file/i }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: /generate & download/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/PFMS gateway timeout/);
    expect(alert.textContent).not.toMatch(/PFMS_TIMEOUT/);
    expect(alert.textContent).not.toMatch(/\b502\b/);
  });

  // ── GAP-PAYROLL-DISBURSEMENT-02 ──────────────────────────────────────────
  it("[DISB-02] Download opens a reason-gated confirm; the POST fires only after a >=10 char reason", async () => {
    fetchMock.mockResolvedValue(okFile());
    renderWizard();
    goToDownloadStep();
    fireEvent.click(screen.getByRole("button", { name: /download bank file/i }));

    expect(screen.getByText("Generate this bank file?")).toBeInTheDocument();
    expect(screen.getByText(/2026-09 · NEFT \/ RTGS \(CSV\) · 37 records · net ₹4,50,000\.00/)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: /generate & download/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "too short" } });
    expect(confirm).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: REASON } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/payroll/runs/r1/bank-file");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ format: "csv", reason: REASON });
    expect(await screen.findByText("File Downloaded")).toBeInTheDocument();
    expect(screen.getByText("bank_transfer_RUN1_2026-09.csv")).toBeInTheDocument();
  });

  it("[DISB-02] a paid run is labelled a re-issue, with a duplicate-payment warning in the confirm", () => {
    renderWizard([PAID_RUN]);
    expect(screen.getByText(/already marked paid/)).toBeInTheDocument();
    goToDownloadStep();
    fireEvent.click(screen.getByRole("button", { name: /download bank file/i }));
    expect(screen.getByText("Re-issue a bank file for a paid run?")).toBeInTheDocument();
    expect(screen.getByText(/paying salaries twice/)).toBeInTheDocument();
  });

  // ── GAP-PAYROLL-DISBURSEMENT-03 ──────────────────────────────────────────
  it("[DISB-03] success screen shows UNSIGNED unless the server explicitly says the file is signed", async () => {
    fetchMock.mockResolvedValue(okFile({ "x-bank-file-signed": "false" }));
    renderWizard();
    goToDownloadStep();
    fireEvent.click(screen.getByRole("button", { name: /download bank file/i }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: /generate & download/i }));
    expect(await screen.findByText(/UNSIGNED/)).toBeInTheDocument();
    expect(screen.queryByText("Signed")).not.toBeInTheDocument();
  });

  it("[DISB-03] success screen shows Signed when the server sends x-bank-file-signed: true", async () => {
    fetchMock.mockResolvedValue(okFile({ "x-bank-file-signed": "true" }));
    renderWizard();
    goToDownloadStep();
    fireEvent.click(screen.getByRole("button", { name: /download bank file/i }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: /generate & download/i }));
    expect(await screen.findByText("Signed")).toBeInTheDocument();
    expect(screen.queryByText(/UNSIGNED/)).not.toBeInTheDocument();
  });

  it("[DISB-03] an expired DSC is flagged as an error on the DSC step", () => {
    renderWizard([RUN], { kind: "configured", subjectCn: "CN=DDO", notAfter: isoDaysFromNow(-3), sha256Fingerprint: "AB".repeat(32) });
    fireEvent.click(screen.getByRole("button", { name: /next: preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /next: dsc/i }));
    expect(screen.getByText(/DSC has expired/)).toBeInTheDocument();
  });

  it("[DISB-03] a DSC expiring within 30 days shows a renewal warning", () => {
    renderWizard([RUN], { kind: "configured", subjectCn: "CN=DDO", notAfter: isoDaysFromNow(10), sha256Fingerprint: "AB".repeat(32) });
    fireEvent.click(screen.getByRole("button", { name: /next: preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /next: dsc/i }));
    expect(screen.getByText(/DSC expires in \d+ day\(s\)/)).toBeInTheDocument();
  });

  it("[DISB-03] the DSC step no longer claims the file will be signed", () => {
    renderWizard([RUN], { kind: "configured", subjectCn: "CN=DDO", notAfter: isoDaysFromNow(400), sha256Fingerprint: "AB".repeat(32) });
    fireEvent.click(screen.getByRole("button", { name: /next: preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /next: dsc/i }));
    expect(screen.queryByText(/ready to sign/i)).not.toBeInTheDocument();
    expect(screen.getByText(/not digitally signed by this system yet/)).toBeInTheDocument();
  });

  // ── GAP-PAYROLL-DISBURSEMENT-05 ──────────────────────────────────────────
  it("[DISB-05] preview shows the run's real record count and no fabricated sample row", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /next: preview/i }));
    const row = screen.getByText("Record Count").closest("tr");
    expect(row).toHaveTextContent("37");
    expect(document.body.textContent).not.toMatch(/EMP001/);
    expect(document.body.textContent).not.toMatch(/\[Sample/);
  });

  // ── GAP-PAYROLL-DISBURSEMENT-06 ──────────────────────────────────────────
  it("[DISB-06] labels NACH as a credit file and defaults to CSV", () => {
    renderWizard();
    expect(screen.getByLabelText("NACH Credit (ACH-CR)")).toBeInTheDocument();
    expect(screen.queryByText(/NACH Debit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/mandate file/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("NEFT / RTGS (CSV)")).toBeChecked();
  });

  it("[DISB-06] disables NACH when the sponsor config has NACH switched off; APBS is never selectable", () => {
    renderWizard([RUN], { kind: "none" }, { nachEnabled: false });
    expect(screen.getByLabelText("NACH Credit (ACH-CR)")).toBeDisabled();
    expect(screen.getByLabelText("APBS (Text)")).toBeDisabled();
    expect(screen.getByLabelText("NEFT / RTGS (CSV)")).toBeEnabled();
  });

  it("[DISB-06] leaves NACH selectable when the sponsor config is unknown to this viewer", () => {
    renderWizard([RUN], { kind: "restricted" }, { nachEnabled: null });
    expect(screen.getByLabelText("NACH Credit (ACH-CR)")).toBeEnabled();
  });
});
