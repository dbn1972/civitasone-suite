import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: (...a: unknown[]) => browserFetch(...a),
  errorMessageFromResponse: async () => "generic failure",
  errorCodeFromResponse: async (res: Response) => {
    try { return ((await res.clone().json()) as { code?: string }).code ?? null; } catch { return null; }
  },
}));

import { TaxProofsPanel } from "./TaxProofsPanel";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LINES = ["rent", "sec80c", "sec80d", "sec80g", "home_loan_interest", "other"];
const summary = (over: Record<string, unknown> = {}) => LINES.map((line) => ({
  line, total: 0, pending: 0, accepted: 0, rejected: 0, maxFiles: 10, declaredMinor: null, verifiedMinor: "0", ...(over[line] as object | undefined),
}));
const file = (id: string, line: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, line, fy: "2025-26", filename: `${id}.pdf`, contentType: "application/pdf", sizeBytes: 2048, amountMinor: null,
  status, rejectionReason: null, createdAt: "2026-01-01T00:00:00Z", decidedAt: null, ...extra,
});

function ui() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TaxProofsPanel fy="2025-26" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => browserFetch.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("TaxProofsPanel (GAP-PAYROLL-TAX-DECLARATION-02)", () => {
  it("lists files per line with a status pill, shows a rejection reason, and offers Remove only while pending", async () => {
    browserFetch.mockResolvedValueOnce(json({
      fy: "2025-26",
      items: [file("p-pend", "sec80c", "pending"), file("p-acc", "sec80c", "accepted", { amountMinor: "5000000" }), file("p-rej", "rent", "rejected", { rejectionReason: "Receipt is illegible" })],
      summary: summary({ sec80c: { declaredMinor: "15000000", verifiedMinor: "5000000" } }),
    }));
    ui();
    await screen.findByText("p-pend.pdf");
    expect(screen.getByText("Awaiting verification")).toBeInTheDocument();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText(/Reason: Receipt is illegible/)).toBeInTheDocument();
    expect(screen.getByText(/Declared ₹1,50,000\.00 · Verified by payroll ₹50,000\.00/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove p-pend.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove p-acc.pdf" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove p-rej.pdf" })).not.toBeInTheDocument();
    // never a raw status enum
    expect(screen.queryByText("pending")).not.toBeInTheDocument();
  });

  it("tells the employee when only accepted documents will count for TDS, only if the tenant opted in", async () => {
    browserFetch.mockResolvedValueOnce(json({ fy: "2025-26", items: [], summary: summary(), verifiedTdsEnabled: true, cutoffDate: "2026-01-31" }));
    const a = ui();
    await screen.findByText(/After 31 Jan 2026, only accepted documents count towards your tax deduction \(TDS\)\./);
    a.unmount();
    browserFetch.mockReset();
    browserFetch.mockResolvedValueOnce(json({ fy: "2025-26", items: [], summary: summary(), verifiedTdsEnabled: false, cutoffDate: null }));
    ui();
    await screen.findByText(/Supporting documents for FY 2025-26/);
    expect(screen.queryByText(/only accepted documents count/)).not.toBeInTheDocument();
  });

  it("removes a pending file after confirmation", async () => {
    browserFetch
      .mockResolvedValueOnce(json({ fy: "2025-26", items: [file("p-pend", "sec80c", "pending")], summary: summary() }))
      .mockResolvedValueOnce(json({ id: "p-pend", status: "accepted" }, 202))
      .mockImplementation(async () => json({ fy: "2025-26", items: [], summary: summary() }));
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Remove p-pend.pdf" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(browserFetch).toHaveBeenCalledWith("v1/payroll/tax-proofs/p-pend", { method: "DELETE" }));
    await screen.findByText("File removed.");
  });

  it("refuses an oversize or wrong-type file before any request is made", async () => {
    browserFetch.mockResolvedValueOnce(json({ fy: "2025-26", items: [], summary: summary() }));
    const { container } = ui();
    await screen.findByText(/Supporting documents for FY 2025-26/);
    const input = container.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    const calls = browserFetch.mock.calls.length;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.zip", { type: "application/zip" })] } });
    await screen.findByText("Only PDF, JPG or PNG files can be uploaded.");
    const big = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    await screen.findByText("That file is too large. The limit is 10 MB.");
    expect(browserFetch.mock.calls.length).toBe(calls);
  });

  it("uploads a valid file (presign, direct PUT with the signed headers, attach) and shows a success message", async () => {
    browserFetch
      .mockResolvedValueOnce(json({ fy: "2025-26", items: [], summary: summary() }))
      .mockResolvedValueOnce(json({ storageKey: "k", uploadUrl: "https://s3.test/put", headers: { "x-amz-server-side-encryption": "AES256" } }))
      .mockResolvedValueOnce(json({ id: "n", status: "accepted" }, 202))
      .mockImplementation(async () => json({ fy: "2025-26", items: [file("n", "rent", "pending")], summary: summary() }));
    const put = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", put);
    const { container } = ui();
    await screen.findByText(/Supporting documents for FY 2025-26/);
    const input = container.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["%PDF"], "rent.pdf", { type: "application/pdf" })] } });
    await screen.findByText(/File uploaded/);
    expect(put).toHaveBeenCalledWith("https://s3.test/put", expect.objectContaining({ method: "PUT", headers: { "x-amz-server-side-encryption": "AES256" } }));
  });

  it("shows the server's per-line limit as a clear message", async () => {
    browserFetch
      .mockResolvedValueOnce(json({ fy: "2025-26", items: [], summary: summary() }))
      .mockResolvedValueOnce(json({ code: "PROOF_LIMIT_REACHED" }, 409));
    const { container } = ui();
    await screen.findByText(/Supporting documents for FY 2025-26/);
    const input = container.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["%PDF"], "rent.pdf", { type: "application/pdf" })] } });
    await screen.findByText("This line already has 10 files. Remove one to add another.");
  });

  it("disables adding when a line already has 10 files", async () => {
    browserFetch.mockResolvedValueOnce(json({
      fy: "2025-26", items: Array.from({ length: 10 }, (_, i) => file(`f${i}`, "sec80d", "pending")), summary: summary({ sec80d: { total: 10, pending: 10 } }),
    }));
    ui();
    await screen.findByText("f0.pdf");
    expect(screen.getByRole("button", { name: "Add a file for Section 80D (health insurance)" })).toBeDisabled();
  });

  it("explains employee-only upload on a 403 and offers Retry on a load failure", async () => {
    browserFetch.mockResolvedValueOnce(json({ code: "FORBIDDEN" }, 403));
    const first = ui();
    await screen.findByText(/Document upload is available to employees/);
    first.unmount();

    browserFetch.mockReset();
    browserFetch
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(json({ fy: "2025-26", items: [], summary: summary() }));
    ui();
    await screen.findByRole("alert");
    expect(screen.queryByText(/\b500\b/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText(/Supporting documents for FY 2025-26/);
  });
});
