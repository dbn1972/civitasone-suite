import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { LedgerExportPanel, type LedgerModeInfo, type LedgerRun } from "./LedgerExportPanel";

const RUNS: LedgerRun[] = [
  { id: "run-approved", payPeriod: "2026-08", status: "completed" },
  { id: "run-paid", payPeriod: "2026-07", status: "paid" },
  { id: "run-draft", payPeriod: "2026-09", status: "draft" },
];
const DERIVED: LedgerModeInfo = { mode: "export", source: "derived", override: null };

function renderPanel(opts: { mode?: LedgerModeInfo; canConfirm?: boolean; runs?: LedgerRun[]; locale?: "en" | "hi" } = {}) {
  const locale = opts.locale ?? "en";
  render(
    <NextIntlClientProvider locale={locale} messages={(locale === "hi" ? hiMessages : enMessages) as never}>
      <LedgerExportPanel runs={opts.runs ?? RUNS} mode={opts.mode ?? DERIVED} canConfirm={opts.canConfirm ?? true} />
    </NextIntlClientProvider>,
  );
}

describe("LedgerExportPanel (payroll without Finance)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("explains why it is shown: derived from the modules, or set by an administrator", () => {
    renderPanel();
    expect(screen.getByText(/does not use the Finance module/)).toBeInTheDocument();
    renderPanel({ mode: { mode: "export", source: "override", override: "export" } });
    expect(screen.getByText(/administrator has set payroll to export-only/)).toBeInTheDocument();
  });

  it("offers the journal for approved and disbursed runs only, and downloads CSV from the export endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("a,b", { status: 200, headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="payroll-journal-2026-08.csv"' } }),
    );
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    renderPanel();
    const select = screen.getAllByLabelText(/Payroll run/)[0] as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.text)).toEqual(["2026-08", "2026-07"]);
    fireEvent.click(screen.getByText("Download CSV"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("v1/payroll/runs/run-approved/journal-export?format=csv");
  });

  it("asks for the Tally format when chosen", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<x/>", { status: 200, headers: { "content-type": "application/xml" } }));
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    renderPanel();
    fireEvent.click(screen.getByText("Download Tally file"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("format=tally");
  });

  it("says so plainly when the journal cannot be downloaded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    renderPanel();
    fireEvent.click(screen.getByText("Download CSV"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Could not download the journal/));
  });

  it("requires file content, then marks salaries paid only after a confirmation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { rows: 3, success: 2, failed: 1 } }), { status: 202 }),
    );
    renderPanel();
    fireEvent.click(screen.getByText("Mark paid from file"));
    expect(screen.getAllByText("Choose a payroll run and add the bank file.").length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/File content/), { target: { value: "EMP-1,42000,UTR1,SUCCESS" } });
    fireEvent.click(screen.getByText("Mark paid from file"));
    await waitFor(() => expect(screen.getByText("Mark these salaries as paid?")).toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Mark paid"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("v1/payroll/runs/run-paid/bank-confirmation");
    expect(JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body))).toEqual({ content: "EMP-1,42000,UTR1,SUCCESS" });
    await waitFor(() => expect(screen.getByText(/Queued: 3 rows \(2 paid, 1 reported failed\)/)).toBeInTheDocument());
  });

  it("a non-administrator sees the journal but not the confirmation form or the mode switch", () => {
    renderPanel({ canConfirm: false });
    expect(screen.getByText("Download CSV")).toBeInTheDocument();
    expect(screen.getByText("Only a payroll administrator can mark salaries as paid.")).toBeInTheDocument();
    expect(screen.queryByText("Mark paid from file")).toBeNull();
    expect(screen.queryByText("Save mode")).toBeNull();
  });

  it("with no disbursed run there is nothing to confirm", () => {
    renderPanel({ runs: [{ id: "a", payPeriod: "2026-08", status: "completed" }] });
    expect(screen.getByText("No disbursed payroll run to confirm yet.")).toBeInTheDocument();
  });

  it("saves the override with the stored protected-net floor, and clears it with null", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
      (init as RequestInit | undefined)?.method === "PUT"
        ? new Response(JSON.stringify({ id: "t", status: "accepted" }), { status: 202 })
        : new Response(JSON.stringify({ protectedNetFloorMinor: 500000 }), { status: 200 }));
    renderPanel({ mode: { mode: "export", source: "override", override: "export" } });
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save mode"));
    await waitFor(() => expect(screen.getByText("Ledger mode saved.")).toBeInTheDocument());
    const put = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT")!;
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({ protectedNetFloorMinor: 500000, ledgerModeOverride: null });
  });

  it("is fully translated in Hindi", () => {
    renderPanel({ locale: "hi" });
    expect(screen.getByText("वेतन जर्नल")).toBeInTheDocument();
    expect(screen.getByText("CSV डाउनलोड करें")).toBeInTheDocument();
    expect(screen.getByText("बैंक पुष्टि")).toBeInTheDocument();
  });
});
