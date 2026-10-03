import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { BankFileSigningForm } from "./BankFileSigningForm";
import type { SigningSettings } from "./signingState";

const BASE: SigningSettings = {
  config: { format: "pgp_detached", perBankOverrides: {}, encryptToBank: false, keyRef: "default" },
  isDefault: true,
  unsignedAllowed: true,
  key: { provider: "dev-file", present: true, fingerprint: "00AA11BB22CC33DD44EE55FF66AA77BB88CC99DD", detail: null },
};
const REASON = "Bank H2H channel requires PKCS7 signatures";

function renderForm(settings: SigningSettings = BASE, locale: "en" | "hi" = "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
      <BankFileSigningForm settings={settings} />
    </NextIntlClientProvider>,
  );
}
const fmtSelect = () => screen.getByLabelText(/Signing format/) as HTMLSelectElement;

describe("BankFileSigningForm", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("shows key present + public fingerprint tail only, and the default note", () => {
    renderForm();
    expect(screen.getByText("Signing key present")).toBeInTheDocument();
    expect(screen.getByText("66AA77BB88CC99DD")).toBeInTheDocument();
    expect(screen.getByText(/signed with OpenPGP detached signatures \(the default\)/)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/PRIVATE KEY/);
  });

  it("shows 'Signing key missing' with the server's reason when no key exists", () => {
    renderForm({ ...BASE, key: { provider: "keystore", present: false, fingerprint: null, detail: "keystore adapter not implemented until UAT" } });
    expect(screen.getByText("Signing key missing")).toBeInTheDocument();
    expect(screen.getByText(/not implemented until UAT/)).toBeInTheDocument();
  });

  it("offers all four formats; in production the unsigned option is disabled", () => {
    renderForm({ ...BASE, unsignedAllowed: false });
    const opts = within(fmtSelect()).getAllByRole("option") as HTMLOptionElement[];
    expect(opts).toHaveLength(4);
    expect(opts.find((o) => o.value === "none")!.disabled).toBe(true);
    expect(opts.filter((o) => o.value !== "none").every((o) => !o.disabled)).toBe(true);
    expect(screen.getByText(/not allowed in production/)).toBeInTheDocument();
  });

  it("choosing Unsigned shows the dev-only warning and disables encrypt-to-bank", () => {
    renderForm();
    fireEvent.click(screen.getByLabelText(/Also encrypt the file/));
    expect(screen.getByLabelText(/Also encrypt the file/)).toBeChecked();
    fireEvent.change(fmtSelect(), { target: { value: "none" } });
    expect(screen.getByText(/Unsigned files are for development and sandbox only/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Also encrypt the file/)).toBeDisabled();
  });

  it("per-bank overrides: add, edit and validate the bank code", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Add bank override" }));
    fireEvent.change(screen.getByLabelText("Bank code"), { target: { value: "sb" } });
    fireEvent.click(screen.getByRole("button", { name: "Save signing setting" }));
    expect(screen.getByRole("alert")).toHaveTextContent("exactly 4 capital letters");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Bank code"), { target: { value: "sbin" } });
    expect((screen.getByLabelText("Bank code") as HTMLInputElement).value).toBe("SBIN");
  });

  it("rejects a path-like key reference before any request", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/Signing key reference/), { target: { value: "../etc/passwd" } });
    fireEvent.click(screen.getByRole("button", { name: "Save signing setting" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/key reference must be/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves through a reason dialog: PUT with format, overrides, encrypt flag, keyRef and reason; then confirms", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "x", status: "accepted" }), { status: 202, headers: { "content-type": "application/json" } }));
    renderForm();
    fireEvent.change(fmtSelect(), { target: { value: "pkcs7_detached" } });
    fireEvent.click(screen.getByRole("button", { name: "Add bank override" }));
    fireEvent.change(screen.getByLabelText("Bank code"), { target: { value: "HDFC" } });
    fireEvent.click(screen.getByLabelText(/Also encrypt the file/));
    fireEvent.click(screen.getByRole("button", { name: "Save signing setting" }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Save setting" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/payroll/bank-file-signing");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      format: "pkcs7_detached", perBankOverrides: { HDFC: "pkcs7_detached" }, encryptToBank: true, keyRef: "default", reason: REASON,
    });
    expect(await screen.findByText(/Saved\. The change is applied shortly/)).toBeInTheDocument();
  });

  it("a rejected save shows a clerk-safe message, never the raw server code", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "UNSIGNED_NOT_ALLOWED_IN_PRODUCTION", message: "raw backend text" }), { status: 422, headers: { "content-type": "application/json" } }));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Save signing setting" }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Save setting" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(document.body.textContent).not.toMatch(/Saving|Working/));
    expect(document.body.textContent).not.toMatch(/UNSIGNED_NOT_ALLOWED_IN_PRODUCTION|raw backend text/);
  });

  it("a network failure shows a retryable message", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Save signing setting" }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Save setting" }));
    expect((await screen.findAllByText(/Check your internet connection/)).length).toBeGreaterThan(0);
  });

  it("renders in Hindi with every label translated", () => {
    renderForm(BASE, "hi");
    expect(screen.getByText("हस्ताक्षर कुंजी उपलब्ध है")).toBeInTheDocument();
    expect(screen.getByLabelText(/हस्ताक्षर प्रारूप/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "हस्ताक्षर सेटिंग सहेजें" })).toBeInTheDocument();
  });
});
