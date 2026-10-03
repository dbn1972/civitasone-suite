import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { LetterheadForm } from "./LetterheadForm";
import { mapLetterhead } from "./letterhead";

function renderForm(initial: React.ComponentProps<typeof LetterheadForm>["initial"] = null) {
  render(<NextIntlClientProvider locale="en" messages={enMessages}><LetterheadForm initial={initial} /></NextIntlClientProvider>);
}

describe("LetterheadForm (GAP-PAYROLL-SALARY-SLIPS-DETAIL-02)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); refreshMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("mapLetterhead: null stays null (nothing configured), junk is rejected, empty strings become null", () => {
    expect(mapLetterhead({ data: null })).toBeNull();
    expect(mapLetterhead({})).toBeUndefined();
    expect(mapLetterhead({ data: { orgName: "" } })).toBeUndefined();
    expect(mapLetterhead({ data: { orgName: "Dept", department: "  ", ddoCode: "D1", showSignatureBlock: true } })).toEqual({
      orgName: "Dept", department: null, ddoName: null, ddoCode: "D1", address: null, signatoryTitle: null, showSignatureBlock: true,
    });
  });

  it("requires the organisation name before anything is sent", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Save letterhead" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the organisation name.");
    expect(screen.getByLabelText(/^Organisation name/)).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms, PUTs the letterhead (blank optionals as null) and refreshes", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: "x", status: "accepted", correlationId: "c" }), { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Organisation name/), { target: { value: "  Directorate of Urban Affairs " } });
    fireEvent.change(screen.getByLabelText(/^DDO code/), { target: { value: "DDO-114" } });
    fireEvent.click(screen.getByLabelText(/Print a signature block/));
    fireEvent.click(screen.getByRole("button", { name: "Save letterhead" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("name Directorate of Urban Affairs as the issuing organisation");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save letterhead" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/payroll/letterhead");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      orgName: "Directorate of Urban Affairs", department: null, ddoName: null, ddoCode: "DDO-114", address: null, signatoryTitle: null, showSignatureBlock: true,
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("a refused save (403) is shown and the page is not refreshed", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ code: "FORBIDDEN", message: "role not permitted" }), { status: 403 }));
    renderForm({ orgName: "Dept", department: null, ddoName: null, ddoCode: null, address: null, signatoryTitle: null, showSignatureBlock: false });
    fireEvent.click(screen.getByRole("button", { name: "Save letterhead" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Save letterhead" }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent(/permission|couldn't|not allowed|role/i));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
