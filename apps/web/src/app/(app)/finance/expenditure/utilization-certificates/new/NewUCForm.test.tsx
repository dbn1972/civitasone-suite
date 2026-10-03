import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { NewUCForm } from "./NewUCForm";

// UX-017 (tranche 10): see AdvancesTable/NewAdvancePage's identical note --
// NewUCPage is a "use client" component calling useTranslations(), so it
// needs a real NextIntlClientProvider even though the page itself doesn't
// nest any other translated component.
function renderPage(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function fillForm() {
  fireEvent.change(screen.getByLabelText("UC number"), { target: { value: "UC-001" } });
  fireEvent.change(screen.getByLabelText("Grantee (body that utilised the grant)"), { target: { value: "Gram Panchayat Rampur" } });
  fireEvent.change(screen.getByLabelText("Amount utilised (₹)"), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Scheme expenditure" } });
  fireEvent.click(screen.getByLabelText(/I certify that the grant was utilised/));
}

describe("NewUCForm", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("submits a utilization certificate (happy path, 202 accepted)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    renderPage(<NewUCForm schemes={[]} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit certificate" }));

    await waitFor(() => expect(screen.getByText("Utilization certificate submitted.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/finance/utilization-certificates",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // UX-016: the shared `parseErrorMessage` helper used to build the message
  // from the backend's own `message`/`error` field, or (when the body
  // wasn't JSON) the RAW response text verbatim, falling back to a literal
  // `Request failed (${res.status})` -- the same class of leak
  // useFormError/toHumanError closes fleet-wide (UX-003).
  it("shows a clerk-safe message when submission fails, never the raw status or backend text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "scheme_closed: grant window has ended" }), { status: 422 }),
    );

    renderPage(<NewUCForm schemes={[]} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit certificate" }));

    const alert = await screen.findByText(/Some details weren't accepted\. Check what you entered and try again\./);
    expect(alert.textContent).not.toMatch(/scheme_closed/i);
    expect(alert.textContent).not.toMatch(/\b422\b/);
  });

  // GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-01
  it("makes no request without the declaration ticked", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderPage(<NewUCForm schemes={[]} />);
    fillForm();
    fireEvent.click(screen.getByLabelText(/I certify that the grant was utilised/)); // untick
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));
    expect(await screen.findByText("Tick the declaration to submit.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with the declaration ticked shows a confirm dialog, then POSTs exactly once with an idempotency key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    renderPage(<NewUCForm schemes={[]} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("₹1,000.00");
    expect(fetchMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole("button", { name: "Submit certificate" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toBeTruthy();
  });

  // GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-02 / -01 (declaration persisted)
  it("requires a grantee (no POST without one) and sends grantee + declaration:true", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    renderPage(<NewUCForm schemes={[]} />);
    fillForm();
    fireEvent.change(screen.getByLabelText("Grantee (body that utilised the grant)"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));
    expect(await screen.findByText("Name the grantee.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Grantee (body that utilised the grant)"), { target: { value: "  District Health Society " } });
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit certificate" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ grantee: "District Health Society", declaration: true });
  });

  it("shows the server's over-claim message on the amount field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "UC_OVERCLAIM", message: "x", fieldErrors: [{ field: "amountMinor", message: "This is more than the sanctioned grant still leaves." }],
    }), { status: 409 }));
    renderPage(<NewUCForm schemes={[]} />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit certificate" }));
    expect(await screen.findByText("This is more than the sanctioned grant still leaves.")).toBeInTheDocument();
  });

  // GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-02
  it("sends grant ref and period, and rejects period start after end with no POST", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    renderPage(<NewUCForm schemes={[]} />);
    fillForm();
    fireEvent.change(screen.getByLabelText("Grant reference"), { target: { value: "GR-9" } });
    fireEvent.change(screen.getByLabelText("Period from"), { target: { value: "2026-04-10" } });
    fireEvent.change(screen.getByLabelText("Period to"), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));
    expect(await screen.findByText(/period start must be on or before/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Period to"), { target: { value: "2026-06-30" } });
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit certificate" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ grantRef: "GR-9", periodFrom: "2026-04-10", periodTo: "2026-06-30", amountMinor: "100000" });
  });

  // GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-03
  it("offers a scheme picker, blocks an empty selection, and sends the chosen scheme", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    renderPage(<NewUCForm schemes={[{ code: "PMAY", name: "Housing Scheme" }, { code: "MGN", name: "Rural Jobs" }]} />);
    const picker = screen.getByLabelText("Scheme / grant") as HTMLSelectElement;
    expect(picker.tagName).toBe("SELECT");
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));
    expect(await screen.findByText("Select the scheme this certificate is for.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(picker, { target: { value: "Housing Scheme" } });
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit certificate" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ scheme: "Housing Scheme" });
  });

  it("disables submit when the scheme list failed to load (no free-text fallback)", () => {
    renderPage(<NewUCForm schemes={null} />);
    expect((screen.getByLabelText("Scheme / grant") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /submit uc/i })).toBeDisabled();
  });
});
