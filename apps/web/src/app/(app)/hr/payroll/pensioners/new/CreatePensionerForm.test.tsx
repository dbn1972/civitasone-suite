import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { CreatePensionerForm } from "./CreatePensionerForm";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreatePensionerForm />
    </NextIntlClientProvider>,
  );
}

function fill(values: Partial<Record<"ppo" | "name" | "dob" | "basic" | "commuted" | "commDate" | "account" | "ifsc" | "pan", string>>) {
  const v = { ppo: "PPO/2025/001234", name: "Ramesh Kumar Sharma", dob: "1960-01-01", basic: "25000.50", ...values };
  fireEvent.change(screen.getByLabelText(/ppo number/i), { target: { value: v.ppo } });
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: v.name } });
  fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: v.dob } });
  fireEvent.change(screen.getByLabelText(/basic pension/i), { target: { value: v.basic } });
  if (v.commuted !== undefined) fireEvent.change(screen.getByLabelText(/commuted pension/i), { target: { value: v.commuted } });
  if (v.commDate !== undefined) fireEvent.change(screen.getByLabelText(/commutation date/i), { target: { value: v.commDate } });
  if (v.account !== undefined) fireEvent.change(screen.getByLabelText(/bank account/i), { target: { value: v.account } });
  if (v.ifsc !== undefined) fireEvent.change(screen.getByLabelText(/ifsc/i), { target: { value: v.ifsc } });
  if (v.pan !== undefined) fireEvent.change(screen.getByLabelText(/^pan/i), { target: { value: v.pan } });
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: /create pensioner/i }));

describe("CreatePensionerForm", () => {
  it("UX-016: a failed create shows a clerk-safe message, never the raw server text or status", async () => {
    fetchMock.mockResolvedValue(new Response("payroll-service: pensioner insert trace at line 60", { status: 500 }));
    renderForm();
    fill({});
    submit();
    const confirmButtons = screen.getAllByRole("button", { name: /create pensioner/i });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/payroll-service/);
    expect(document.body.textContent).not.toMatch(/\b500\b/);
  });

  it("GAP-PAYROLL-PENSIONERS-NEW-01: blank basic pension shows an error, flags the field and sends no request", () => {
    renderForm();
    fill({ basic: "" });
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(/basic pension is required/i);
    expect(screen.getByLabelText(/basic pension/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/basic pension/i)).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-PENSIONERS-NEW-01: zero basic pension is rejected too", () => {
    renderForm();
    fill({ basic: "0" });
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(/basic pension is required/i);
  });

  it("GAP-PAYROLL-PENSIONERS-NEW-01: a future date of birth is rejected", () => {
    renderForm();
    fill({ dob: "2999-01-01" });
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(/date of birth cannot be in the future/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GAP-PAYROLL-PENSIONERS-NEW-04: commuted amount without a commutation date is rejected inline", () => {
    renderForm();
    fill({ commuted: "5000" });
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(/both the commuted pension amount and the commutation date/i);
    expect(screen.getByLabelText(/commutation date/i)).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GAP-PAYROLL-PENSIONERS-NEW-04: a commutation date without an amount is rejected", () => {
    renderForm();
    fill({ commDate: "2020-01-01" });
    submit();
    expect(screen.getByLabelText(/commuted pension/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("GAP-PAYROLL-PENSIONERS-NEW-04: a commutation date before the DOB is rejected", () => {
    renderForm();
    fill({ commuted: "5000", commDate: "1950-01-01" });
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(/before the date of birth/i);
  });

  it("GAP-PAYROLL-PENSIONERS-NEW-02: an invalid IFSC is blocked client-side", () => {
    renderForm();
    fill({ ifsc: "SBIN1001234" });
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(/IFSC must be 11 characters/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GAP-PAYROLL-PENSIONERS-NEW-02: a too-short bank account is blocked", () => {
    renderForm();
    fill({ account: "12345" });
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent(/9 to 18 digits/i);
  });

  it("GAP-PAYROLL-PENSIONERS-NEW-02: shows the DPDP notice and disables autofill on bank/PAN inputs", () => {
    renderForm();
    expect(screen.getByText(/DPDP Act, 2023/)).toBeInTheDocument();
    expect(screen.getByLabelText(/bank account/i)).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText(/ifsc/i)).toHaveAttribute("autocomplete", "off");
    expect(screen.getByLabelText(/^pan/i)).toHaveAttribute("autocomplete", "off");
  });

  it("GAP-PAYROLL-PENSIONERS-NEW-02: submit opens a confirm dialog with the summary and masked account; cancel sends nothing", () => {
    renderForm();
    fill({ account: "123456789012" });
    submit();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("PPO/2025/001234");
    expect(dialog).toHaveTextContent("₹25,000.50");
    expect(dialog).toHaveTextContent("•••• 9012");
    expect(dialog.textContent).not.toContain("123456789012");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GAP-PAYROLL-PENSIONERS-NEW-01/03: confirm posts paise strings via browserFetch (device header) and refreshes", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "x", status: "accepted" }), { status: 202 }));
    renderForm();
    fill({ commuted: "5000", commDate: "2020-06-30", ifsc: "sbin0001234", pan: "abcde1234f" });
    submit();
    const buttons = screen.getAllByRole("button", { name: /create pensioner/i });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/payroll/pensioners");
    expect((init.headers as Record<string, string>)["x-device-id"]).toBeTruthy();
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      basicPensionMinor: "2500050",
      commutedPensionMinor: "500000",
      commutationDate: "2020-06-30",
      medicalAllowanceMinor: "0",
      bankIfsc: "SBIN0001234",
      pan: "ABCDE1234F",
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/hr/payroll/pensioners"));
    expect(refreshMock).toHaveBeenCalled();
  });
});
