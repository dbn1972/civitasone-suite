import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));
const EMP = { id: "bbbbbbbb-2222-4222-8222-222222222201", label: "Gita Menon (EMP-55)" };
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async (q: string) => (EMP.label.toLowerCase().includes(q.toLowerCase()) ? [EMP] : [])),
  resolveEmployees: vi.fn(async () => []),
}));

import { CreateReimbursementForm, type ClaimSubject } from "./CreateReimbursementForm";

function renderForm(subject: ClaimSubject = { mode: "admin" }) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateReimbursementForm subject={subject} />
    </NextIntlClientProvider>,
  );
}

function accepted() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: "r1", status: "accepted", correlationId: "c" }), { status: 202 }),
  );
}

describe("CreateReimbursementForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("admin: requires a picked employee (no free-text Employee ID)", () => {
    renderForm();
    expect(screen.queryByLabelText(/Employee ID/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Select an employee.");
  });

  it("GAP-PAYROLL-REIMBURSEMENTS-04: rejects a 3-decimal amount", async () => {
    renderForm({ mode: "self", employeeId: EMP.id, label: EMP.label });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "10.005" } });
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Amount must be a positive value in rupees");
  });

  it("self: the employee is fixed to the caller and 10.10 rupees posts 1010 paise (202 envelope)", async () => {
    const fetchSpy = accepted();
    renderForm({ mode: "self", employeeId: EMP.id, label: EMP.label });
    expect(screen.getByDisplayValue(EMP.label)).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "food" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "10.10" } });
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(EMP.label);
    expect(dialog).toHaveTextContent("Aug 2026");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit claim" }));
    await waitFor(() => expect(document.querySelector(".pill.good")).toHaveTextContent("Reimbursement claim of ₹10.10 submitted."));
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({ employeeId: EMP.id, category: "food", amountMinor: 1010, period: "2026-08" });
  });

  it("admin: picks the employee by name and names them in the dialog", async () => {
    accepted();
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Employee/), { target: { value: "Gita" } });
    fireEvent.mouseDown(await screen.findByText(EMP.label));
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "food" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(EMP.label);
    expect(dialog).not.toHaveTextContent(EMP.id);
  });

  it("surfaces a clerk-safe error on the confirm dialog (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 422 }));
    renderForm({ mode: "self", employeeId: EMP.id, label: EMP.label });
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "food" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
    await waitFor(() => expect(screen.getByText("Submit this reimbursement claim?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit claim"));
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  // fin-payroll-03 (GAP-PAYROLL-REIMBURSEMENTS-03): receipts.
  describe("receipts", () => {
    const SELF: ClaimSubject = { mode: "self", employeeId: EMP.id, label: EMP.label };
    function fillClaim(category: string) {
      fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: category } });
      fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "250" } });
      fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-08" } });
    }

    it.each(["medical", "lta", "travel"])("blocks a %s claim without a receipt", (category) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      renderForm(SELF);
      fillClaim(category);
      fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
      expect(document.querySelector(".pill.bad")).toHaveTextContent("Attach at least one receipt");
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("does not require a receipt for a food claim", async () => {
      accepted();
      renderForm(SELF);
      fillClaim("food");
      fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
      expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    });

    it("uploads a receipt via presign + PUT and submits only its storage key", async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.includes("attachments/presign")) {
          return new Response(JSON.stringify({ storageKey: "payroll/t/reimbursements/a/u/bill.pdf", uploadUrl: "https://bucket.example/put?sig=1" }), { status: 200 });
        }
        if (url.startsWith("https://bucket.example")) return new Response(null, { status: 200 });
        return new Response(JSON.stringify({ id: "r1", status: "accepted", correlationId: "c" }), { status: 202 });
      });
      renderForm(SELF);
      fillClaim("medical");
      const file = new File(["%PDF-1.4"], "bill.pdf", { type: "application/pdf" });
      fireEvent.change(screen.getByLabelText(/Receipts/), { target: { files: [file] } });
      await waitFor(() => expect(screen.getByText("bill.pdf")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Submit claim" }));
      await waitFor(() => expect(document.querySelector(".pill.good")).toBeInTheDocument());
      const post = calls.find((c) => c.url.endsWith("v1/payroll/reimbursements") && c.init?.method === "POST")!;
      expect(JSON.parse(String(post.init!.body)).attachmentKeys).toEqual(["payroll/t/reimbursements/a/u/bill.pdf"]);
      const put = calls.find((c) => c.url.startsWith("https://bucket.example"))!;
      expect(put.init?.method).toBe("PUT");
    });

    it("the receipt-required categories are the shared list the server enforces", async () => {
      const { REIMBURSEMENT_RECEIPT_REQUIRED_CATEGORIES } = await import("@civitasone/types");
      const { RECEIPT_REQUIRED_CATEGORIES } = await import("@/lib/payroll/receiptRules");
      expect(RECEIPT_REQUIRED_CATEGORIES).toBe(REIMBURSEMENT_RECEIPT_REQUIRED_CATEGORIES);
    });

    it("a server 422 RECEIPT_REQUIRED is shown as the plain receipt sentence, not the generic failure", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "RECEIPT_REQUIRED", message: "a medical claim needs at least one receipt" }), { status: 422 }));
      renderForm(SELF);
      fillClaim("food"); // client rule passes; the server still refuses
      fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Submit claim" }));
      await waitFor(() => expect(screen.getByText(/Attach at least one receipt/)).toBeInTheDocument());
      expect(screen.queryByText(/needs at least one receipt/)).not.toBeInTheDocument();
    });

    it("rejects a file that is not a PDF or image, without calling the API", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      renderForm(SELF);
      fireEvent.change(screen.getByLabelText(/Receipts/), { target: { files: [new File(["x"], "bill.exe", { type: "application/x-msdownload" })] } });
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("is not a PDF, JPG or PNG"));
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
