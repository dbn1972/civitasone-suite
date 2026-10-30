import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { MedicalInsuranceForm } from "./MedicalInsuranceForm";
import type { MedicalInsurance } from "./insuranceTypes";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const m = enMessages.medicalInsurance;
const EMP = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";
const fetchMock = vi.fn();

const EXISTING: MedicalInsurance = {
  employeeId: EMP, schemeType: "cghs", schemeId: "BEN-TEST-445566", cardNumber: "CGHS-TEST-77881234",
  cardNumberMasked: false, decryptFailed: false, validityFrom: "2026-04-01", validityTo: "2027-03-31",
  tier: "Semi-private", dependants: [{ name: "Test Spouse", relation: "spouse" }], dependantsCount: 1, annualLimitMinor: "50000000",
};

function renderForm(initial: MedicalInsurance | null) {
  render(<NextIntlClientProvider locale="en" messages={enMessages}><MedicalInsuranceForm employeeId={EMP} initial={initial} /></NextIntlClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: initial ? m.editButton : m.addButton }));
}
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The control labelled exactly `label` (a required field's label also carries a "*" marker). */
const field = (label: string) => screen.getByLabelText(new RegExp(`^${escapeRe(label)}\\s*\\*?$`));
const lastBody = () => JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body));

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "x", status: "accepted", correlationId: "c" }), { status: 202 }));
});
afterEach(() => vi.unstubAllGlobals());

describe("MedicalInsuranceForm (HR)", () => {
  it("a new record needs a card number and a valid-from date; nothing is sent until it validates", async () => {
    renderForm(null);
    fireEvent.click(screen.getByRole("button", { name: m.saveButton }));
    expect(await screen.findByText(m.errors.cardNumberRequired)).toBeInTheDocument();
    expect(screen.getByText(m.errors.dateRequired)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a masked placeholder as a card number, valid-to before valid-from, and a bad amount", async () => {
    renderForm(null);
    fireEvent.change(field(m.fieldCardNumber), { target: { value: "**********1234" } });
    fireEvent.change(field(m.fieldValidityFrom), { target: { value: "2027-01-01" } });
    fireEvent.change(field(m.fieldValidityTo), { target: { value: "2026-01-01" } });
    fireEvent.change(field(m.fieldAnnualLimitRupees), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: m.saveButton }));
    expect(await screen.findByText(m.errors.idFormat)).toBeInTheDocument();
    expect(screen.getByText(m.errors.validityOrder)).toBeInTheDocument();
    expect(screen.getByText(m.errors.annualLimit)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates: PUTs the full body with the limit in paise and dependants, then refreshes", async () => {
    renderForm(null);
    fireEvent.change(field(m.fieldSchemeType), { target: { value: "group_mediclaim" } });
    fireEvent.change(field(m.fieldCardNumber), { target: { value: "GMC-TEST-0001" } });
    fireEvent.change(field(m.fieldValidityFrom), { target: { value: "2026-04-01" } });
    fireEvent.change(field(m.fieldAnnualLimitRupees), { target: { value: "500000" } });
    fireEvent.click(screen.getByRole("button", { name: m.addDependant }));
    fireEvent.change(screen.getByLabelText(/^Dependant 1 name/), { target: { value: "Test Child" } });
    fireEvent.change(screen.getByLabelText(/^Dependant 1 relation/), { target: { value: "child" } });
    fireEvent.click(screen.getByRole("button", { name: m.saveButton }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/hrms/medical/insurance/${EMP}`);
    expect(init.method).toBe("PUT");
    expect(lastBody()).toEqual({
      schemeType: "group_mediclaim", cardNumber: "GMC-TEST-0001", validityFrom: "2026-04-01", validityTo: null,
      tier: null, annualLimitMinor: 50000000, dependants: [{ name: "Test Child", relation: "child" }],
    });
    expect(await screen.findByRole("status")).toHaveTextContent(m.saved);
    expect(refresh).toHaveBeenCalled();
  });

  it("edits: never pre-fills or hints the card number; a blank card number / scheme id is omitted (kept), 'remove scheme id' sends null", async () => {
    renderForm(EXISTING);
    expect(field(m.fieldCardNumber)).toHaveValue("");
    // Never prefilled, and the placeholder never embeds the stored value (not even masked).
    expect(field(m.fieldCardNumber)).toHaveAttribute("placeholder", m.keepCurrentPlaceholder);
    expect(field(m.fieldSchemeId)).toHaveValue("");
    expect(document.body.innerHTML).not.toContain("77881234");
    expect(document.body.innerHTML).not.toContain("445566");
    expect(field(m.fieldValidityFrom)).toHaveValue("2026-04-01");
    expect(field(m.fieldAnnualLimitRupees)).toHaveValue("500000.00");
    fireEvent.click(screen.getByLabelText(m.clearSchemeId));
    fireEvent.click(screen.getByRole("button", { name: m.saveButton }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = lastBody();
    expect(body).not.toHaveProperty("cardNumber");
    expect(body.schemeId).toBeNull();
    expect(body.dependants).toEqual([{ name: "Test Spouse", relation: "spouse" }]);
  });

  it("maps the backend's error code to a message", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }));
    renderForm(EXISTING);
    fireEvent.click(screen.getByRole("button", { name: m.saveButton }));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.errors.api.NOT_FOUND);
  });

  it("remove opens the ds ConfirmDialog; nothing is deleted until it is confirmed", async () => {
    renderForm(EXISTING);
    fireEvent.click(screen.getByRole("button", { name: m.deleteButton }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(m.confirmDelete);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: m.deleteButton }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/hrms/medical/insurance/${EMP}`);
    expect(init.method).toBe("DELETE");
    expect(await screen.findByRole("status")).toHaveTextContent(m.deleted);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("cancelling the ConfirmDialog closes it and deletes nothing", async () => {
    renderForm(EXISTING);
    fireEvent.click(screen.getByRole("button", { name: m.deleteButton }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: m.cancelButton }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failed delete keeps the dialog open and shows the error in it", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }));
    renderForm(EXISTING);
    fireEvent.click(screen.getByRole("button", { name: m.deleteButton }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: m.deleteButton }));
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByText(m.errors.api.NOT_FOUND)).toBeInTheDocument());
  });

  it("a brand-new record offers no remove button", () => {
    renderForm(null);
    expect(screen.queryByRole("button", { name: m.deleteButton })).not.toBeInTheDocument();
  });
});
