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

import { TaxProofQueue } from "./TaxProofQueue";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const row = (over: Record<string, unknown> = {}) => ({
  id: "p1", line: "sec80c", fy: "2026-27", filename: "ppf.pdf", contentType: "application/pdf", sizeBytes: 4096, amountMinor: "5000000",
  status: "pending", rejectionReason: null, createdAt: "2026-06-01T00:00:00Z", decidedAt: null,
  employeeId: "e1", employeeName: "Asha Verma", employeeNo: "E-001", legalHold: false, legalHoldReason: null, ...over,
});
const page = (rows: unknown[], counts: Record<string, number> = { pending: 1, accepted: 0, rejected: 0 }) =>
  json({ data: rows, meta: { total: rows.length, limit: 25, offset: 0, counts } });

function ui(props: { canDecide?: boolean; canHold?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TaxProofQueue canDecide={props.canDecide ?? true} canHold={props.canHold ?? false} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => browserFetch.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("TaxProofQueue (GAP-PAYROLL-TAX-DECLARATION-02)", () => {
  it("loads pending proofs for the current FY with name, line, size, amount and status; never a raw id or enum", async () => {
    browserFetch.mockResolvedValueOnce(page([row()]));
    ui();
    await screen.findByText("Asha Verma");
    expect(String(browserFetch.mock.calls[0]![0])).toMatch(/^v1\/payroll\/tax-proofs\?fy=\d{4}-\d{2}&limit=25&offset=0&status=pending$/);
    expect(screen.getByText(/Section 80C/)).toBeInTheDocument();
    expect(screen.getByText(/₹50,000\.00/)).toBeInTheDocument();
    expect(screen.getAllByText("Awaiting verification").length).toBeGreaterThan(1); // filter option + the row's pill
    expect(screen.queryByText("e1")).not.toBeInTheDocument();
    expect(screen.queryByText("pending")).not.toBeInTheDocument();
  });

  it("re-queries when the status filter changes", async () => {
    browserFetch.mockImplementation(async () => page([row()]));
    ui();
    await screen.findByText("Asha Verma");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "rejected" } });
    await waitFor(() => expect(browserFetch.mock.calls.some((c) => String(c[0]).includes("status=rejected"))).toBe(true));
  });

  it("accepts after confirmation (POST accept)", async () => {
    browserFetch
      .mockResolvedValueOnce(page([row()]))
      .mockResolvedValueOnce(json({ id: "p1", status: "accepted" }, 202))
      .mockImplementation(async () => page([]));
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Accept document from Asha Verma" }));
    const dialog = await screen.findByRole("alertdialog");
    // prefilled from the employee's stated amount (Rs 50,000.00)
    expect(within(dialog).getByLabelText("Amount verified on the document (₹)")).toHaveValue(50000);
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(browserFetch).toHaveBeenCalledWith("v1/payroll/tax-proofs/p1/accept", { method: "POST", body: JSON.stringify({ amountMinor: 5000000 }) }));
    await screen.findByText("Accepted the document from Asha Verma.");
  });

  it("the officer can correct the amount, and an empty or invalid amount blocks the accept without a request", async () => {
    browserFetch
      .mockResolvedValueOnce(page([row({ amountMinor: null })]))
      .mockResolvedValueOnce(json({ id: "p1", status: "accepted" }, 202))
      .mockImplementation(async () => page([]));
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Accept document from Asha Verma" }));
    const dialog = await screen.findByRole("alertdialog");
    const amount = within(dialog).getByLabelText("Amount verified on the document (₹)");
    expect(amount).toHaveValue(null); // the employee gave none: nothing prefilled
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    await within(dialog).findByText("Enter the amount shown on the document before accepting it.");
    expect(browserFetch).toHaveBeenCalledTimes(1);
    fireEvent.change(amount, { target: { value: "1234.567" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    await within(dialog).findByText("Enter the amount in rupees, with at most two decimal places.");
    expect(browserFetch).toHaveBeenCalledTimes(1);
    fireEvent.change(amount, { target: { value: "75000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(browserFetch).toHaveBeenCalledWith("v1/payroll/tax-proofs/p1/accept", { method: "POST", body: JSON.stringify({ amountMinor: 7500000 }) }));
  });

  it("maps a server AMOUNT_REQUIRED to a plain sentence", async () => {
    browserFetch
      .mockResolvedValueOnce(page([row()]))
      .mockResolvedValueOnce(json({ code: "AMOUNT_REQUIRED" }, 422));
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Accept document from Asha Verma" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    await within(dialog).findByText("Enter the amount shown on the document before accepting it.");
    expect(screen.queryByText(/AMOUNT_REQUIRED/)).not.toBeInTheDocument();
  });

  it("rejection requires a reason of at least 10 characters and posts it", async () => {
    browserFetch
      .mockResolvedValueOnce(page([row()]))
      .mockResolvedValueOnce(json({ id: "p1", status: "accepted" }, 202))
      .mockImplementation(async () => page([]));
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Reject document from Asha Verma" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Reject" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Receipt is illegible" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(browserFetch).toHaveBeenCalledWith("v1/payroll/tax-proofs/p1/reject", { method: "POST", body: JSON.stringify({ reason: "Receipt is illegible" }) }));
  });

  it("shows the maker-checker message when the server blocks self-verification, never the raw code", async () => {
    browserFetch
      .mockResolvedValueOnce(page([row()]))
      .mockResolvedValueOnce(json({ code: "SELF_VERIFY_FORBIDDEN" }, 403));
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Accept document from Asha Verma" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    await within(dialog).findByText("You cannot verify your own documents. Another payroll officer must do it.");
    expect(screen.queryByText(/SELF_VERIFY_FORBIDDEN/)).not.toBeInTheDocument();
  });

  it("an auditor (canDecide=false) can view but not decide; legal hold only appears for payroll_admin", async () => {
    browserFetch.mockImplementation(async () => page([row()]));
    const a = ui({ canDecide: false, canHold: false });
    await screen.findByText("Asha Verma");
    expect(screen.queryByRole("button", { name: /Accept document/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reject document/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /legal hold/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View ppf.pdf" })).toBeInTheDocument();
    a.unmount();
    ui({ canDecide: true, canHold: true });
    expect(await screen.findByRole("button", { name: "Place ppf.pdf under legal hold" })).toBeInTheDocument();
  });

  it("places a legal hold with a required reason", async () => {
    browserFetch
      .mockResolvedValueOnce(page([row({ status: "accepted" })]))
      .mockResolvedValueOnce(json({ id: "p1", status: "accepted" }, 202))
      .mockImplementation(async () => page([row({ status: "accepted", legalHold: true })]));
    ui({ canDecide: true, canHold: true });
    fireEvent.click(await screen.findByRole("button", { name: "Place ppf.pdf under legal hold" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Court order 123/2026" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Place hold" }));
    await waitFor(() => expect(browserFetch).toHaveBeenCalledWith("v1/payroll/tax-proofs/p1/legal-hold", { method: "PUT", body: JSON.stringify({ hold: true, reason: "Court order 123/2026" }) }));
  });

  it("opens a proof through the audited short-lived link", async () => {
    // Route by URL, not by call order: the queue may legitimately re-fetch its list (the load
    // effect re-runs), and an ordered mockResolvedValueOnce chain then hands the list response
    // to the audited-link call, so window.open is never reached (intermittent; also on main).
    browserFetch.mockImplementation(async (url: string) =>
      String(url).endsWith("/url") ? json({ url: "https://s3.test/get?e=300" }) : page([row()]),
    );
    const open = vi.fn();
    vi.stubGlobal("open", open);
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "View ppf.pdf" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://s3.test/get?e=300", "_blank", "noopener,noreferrer"));
  });

  it("distinguishes an empty queue from a failed load", async () => {
    browserFetch.mockResolvedValueOnce(page([], { pending: 0, accepted: 0, rejected: 0 }));
    const a = ui();
    await screen.findByText("No documents match these filters.");
    a.unmount();
    browserFetch.mockReset();
    browserFetch.mockResolvedValueOnce(new Response("", { status: 500 }));
    ui();
    await screen.findByText("Could not load the verification queue.");
    expect(screen.queryByText("No documents match these filters.")).not.toBeInTheDocument();
  });
});
