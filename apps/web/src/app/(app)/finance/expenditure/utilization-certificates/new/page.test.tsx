import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import NewUCPage from "./page";

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
  fireEvent.change(screen.getByLabelText("Amount utilised (₹)"), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Scheme expenditure" } });
  fireEvent.click(screen.getByLabelText(/I certify that the grant was utilised/));
}

describe("NewUCPage", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("submits a utilization certificate (happy path, 202 accepted)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    renderPage(<NewUCPage />);
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

    renderPage(<NewUCPage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Submit certificate" }));

    const alert = await screen.findByText(/couldn't save/i);
    expect(alert.textContent).not.toMatch(/scheme_closed/i);
    expect(alert.textContent).not.toMatch(/\b422\b/);
  });

  // GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-01
  it("makes no request without the declaration ticked", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderPage(<NewUCPage />);
    fillForm();
    fireEvent.click(screen.getByLabelText(/I certify that the grant was utilised/)); // untick
    fireEvent.click(screen.getByRole("button", { name: /submit uc/i }));
    expect(await screen.findByText("Tick the declaration to submit.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with the declaration ticked shows a confirm dialog, then POSTs exactly once with an idempotency key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    renderPage(<NewUCPage />);
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

  // GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-02
  it("sends grant ref and period, and rejects period start after end with no POST", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    renderPage(<NewUCPage />);
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
});
