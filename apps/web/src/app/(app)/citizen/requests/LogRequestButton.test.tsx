import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { LogRequestButton } from "./LogRequestButton";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function renderButton() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LogRequestButton />
    </NextIntlClientProvider>,
  );
}

describe("LogRequestButton — GAP-CITIZEN-REQUESTS-03 (DPDP consent)", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("blocks submission until DPDP consent is given", async () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenRequests.logRequest }));
    fireEvent.change(screen.getByLabelText(enMessages.citizenRequests.subject), { target: { value: "No water" } });
    fireEvent.change(screen.getByLabelText(enMessages.citizenRequests.description), { target: { value: "No supply for 3 days" } });
    // Consent unchecked -> submit disabled.
    expect(screen.getByRole("button", { name: enMessages.citizenRequests.submitRequest })).toBeDisabled();
  });

  it("sends structured dpdpConsent in the POST body once consent is given", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenRequests.logRequest }));
    fireEvent.change(screen.getByLabelText(enMessages.citizenRequests.subject), { target: { value: "No water" } });
    fireEvent.change(screen.getByLabelText(enMessages.citizenRequests.description), { target: { value: "No supply for 3 days" } });
    fireEvent.click(screen.getByText(enMessages.citizenRequests.consentLabel));
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenRequests.submitRequest }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.dpdpConsent).toEqual({ given: true, noticeVersion: "2023.1", purpose: "grievance_redressal" });
  });
});
