import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ReceiptPolicyForm } from "./ReceiptPolicyForm";

const REASON = "Audit committee resolved receipts above Rs 5,000";
function renderForm(policy = null as Parameters<typeof ReceiptPolicyForm>[0]["policy"], isDefault = true, locale: "en" | "hi" = "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
      <ReceiptPolicyForm policy={policy} isDefault={isDefault} />
    </NextIntlClientProvider>,
  );
}
const rule = (c: string) => screen.getByLabelText(`Receipt rule for ${c}`) as HTMLSelectElement;
const threshold = (c: string) => screen.getByLabelText(`Receipt required above this amount in rupees, for ${c}`) as HTMLInputElement;
const selfDecl = (c: string) => screen.getByLabelText(`Self-declaration accepted up to this amount in rupees, for ${c}`) as HTMLInputElement;

describe("ReceiptPolicyForm", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the default rules: medical, LTA, travel always; the rest never; inputs disabled accordingly", () => {
    renderForm();
    expect(screen.getByText(/medical, LTA and travel claims need a receipt; all other claims do not/)).toBeInTheDocument();
    for (const c of ["Medical", "LTA", "Travel"]) expect(rule(c).value).toBe("always");
    for (const c of ["Food", "Telephone", "Internet", "Fuel", "Other"]) expect(rule(c).value).toBe("never");
    expect(threshold("Medical")).toBeDisabled();
    expect(selfDecl("Food")).toBeDisabled();
    expect(selfDecl("Medical")).not.toBeDisabled();
  });

  it("every control has an accessible name and the table has a caption and column headers", () => {
    renderForm();
    expect(screen.getByRole("table", { name: "Receipt rule for each reimbursement category" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
    expect(screen.getAllByRole("combobox")).toHaveLength(8);
    expect(screen.getAllByRole("textbox")).toHaveLength(16);
  });

  it("saves only what differs from the default, in paise, with the reason", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "x", status: "accepted", correlationId: "c" }), { status: 202 }));
    renderForm();
    fireEvent.change(rule("Travel"), { target: { value: "above_amount" } });
    fireEvent.change(threshold("Travel"), { target: { value: "5000" } });
    fireEvent.change(selfDecl("Travel"), { target: { value: "7500.50" } });
    fireEvent.change(rule("Medical"), { target: { value: "never" } });
    fireEvent.change(selfDecl("LTA"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save receipt rules" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for the change/), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("v1/payroll/reimbursement-receipt-policy");
    expect((init as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      categories: {
        travel: { mode: "above_amount", thresholdMinor: 500000, selfDeclarationUpToMinor: 750050 },
        medical: { mode: "never" },
        lta: { mode: "always", selfDeclarationUpToMinor: 200000 },
      },
      reason: REASON,
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Receipt rules saved."));
  });

  it("untouched form saves an empty policy (back to defaults)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "x", status: "accepted", correlationId: "c" }), { status: 202 }));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Save receipt rules" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for the change/), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).categories).toEqual({});
  });

  it("validates before opening the dialog: threshold required, self-declaration limit must exceed the threshold; nothing is sent", () => {
    renderForm();
    fireEvent.change(rule("Fuel"), { target: { value: "above_amount" } });
    fireEvent.click(screen.getByRole("button", { name: "Save receipt rules" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount above zero (in rupees) for Fuel.");
    fireEvent.change(threshold("Fuel"), { target: { value: "1000" } });
    fireEvent.change(selfDecl("Fuel"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save receipt rules" }));
    expect(screen.getByRole("alert")).toHaveTextContent("self-declaration limit must be higher");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a refusal from the server (e.g. not an admin) is shown without leaking raw text", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN", message: "RAW forbidden detail" }), { status: 403 }));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Save receipt rules" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for the change/), { target: { value: REASON } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save rules" }));
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByText(/./, { selector: "[role=alert], p" })).toBeTruthy());
    expect(document.body.textContent).not.toContain("RAW forbidden detail");
  });

  it("renders in Hindi with labelled controls", () => {
    renderForm(null, true, "hi");
    expect(screen.getByRole("table", { name: "प्रत्येक प्रतिपूर्ति श्रेणी के लिए रसीद नियम" })).toBeInTheDocument();
    expect(screen.getByLabelText("चिकित्सा के लिए रसीद नियम")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "रसीद नियम सहेजें" })).toBeInTheDocument();
  });
});
