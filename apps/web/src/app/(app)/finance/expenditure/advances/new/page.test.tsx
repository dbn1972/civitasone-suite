import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import NewAdvancePage from "./page";

// UX-017 (tranche 10): NewAdvancePage is a "use client" component that now
// calls useTranslations() -- the centralized vitest.setup.ts mock only covers
// next-intl/server's getTranslations (server components), so a direct render
// of a client component still needs a real NextIntlClientProvider, same as
// every other client-component test (hr/leave/apply/ApplyLeaveForm.test.tsx,
// finance/pfms/page.test.tsx precedent).
function renderPage(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function fillForm() {
  fireEvent.change(screen.getByLabelText("Advance number"), { target: { value: "ADV-001" } });
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Tour advance" } });
  fireEvent.change(screen.getByLabelText("Payee"), { target: { value: "R. Sharma" } });
  fireEvent.change(screen.getByLabelText("Sanctioning authority"), { target: { value: "Under Secretary (Finance)" } });
}

/** The confirm dialog now captures the reason (GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-01). */
async function confirmWithReason(reason = "Sanctioned vide order 12/2031") {
  fireEvent.change(await screen.findByLabelText("Reason for this advance"), { target: { value: reason } });
  fireEvent.click(screen.getByRole("button", { name: "Issue advance" }));
}

describe("NewAdvancePage", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("submits an advance (happy path, 202 accepted)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    renderPage(<NewAdvancePage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();

    await waitFor(() => expect(screen.getByText("Advance recorded.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/finance/advances",
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
      new Response(JSON.stringify({ message: "insufficient_budget: head 2110 is over budget" }), { status: 422 }),
    );

    renderPage(<NewAdvancePage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();

    const alert = await screen.findByText(/Some details weren't accepted\. Check what you entered and try again\./);
    expect(alert.textContent).not.toMatch(/insufficient_budget/i);
    expect(alert.textContent).not.toMatch(/\b422\b/);
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-01
  it("asks for confirmation (with the amount) before POSTing; cancel sends nothing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    renderPage(<NewAdvancePage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("₹1,000.00");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends an x-idempotency-key and a float-free paise string; double-confirm sends ONE request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    renderPage(<NewAdvancePage />);
    fillForm();
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "1.15" } });
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    fireEvent.change(await screen.findByLabelText("Reason for this advance"), { target: { value: "Sanctioned vide order 12/2031" } });
    const confirm = screen.getByRole("button", { name: "Issue advance" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    // 1.15 * 100 === 114.99999999999999 in floats; must be exactly 115 paise.
    expect(JSON.parse(init.body as string).amountMinor).toBe("115");
  });

  it("rejects a sub-paise amount with a field error and makes no request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderPage(<NewAdvancePage />);
    fillForm();
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "10.005" } });
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    expect(await screen.findByText(/at most 2 decimals/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-01: authority + reason are captured and sent
  it("keeps Issue disabled until a reason is typed, then sends sanctionAuthority and reason", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    renderPage(<NewAdvancePage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    const issue = await screen.findByRole("button", { name: "Issue advance" });
    expect(issue).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for this advance"), { target: { value: "abc" } }); // under 5 chars
    expect(issue).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for this advance"), { target: { value: "  Sanctioned vide order 12/2031  " } });
    expect(issue).not.toBeDisabled();
    fireEvent.click(issue);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      sanctionAuthority: "Under Secretary (Finance)", reason: "Sanctioned vide order 12/2031",
    });
  });

  it("blocks submission without a sanctioning authority and sends nothing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderPage(<NewAdvancePage />);
    fillForm();
    fireEvent.change(screen.getByLabelText("Sanctioning authority"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    expect(await screen.findByText("Name the sanctioning authority.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Sanctioning authority")).toBeRequired();
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-03
  it("blocks submission without a payee and sends nothing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderPage(<NewAdvancePage />);
    fireEvent.change(screen.getByLabelText("Advance number"), { target: { value: "ADV-9" } });
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Tour" } });
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    expect(await screen.findByText(/name of the officer or party/i)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Payee")).toBeRequired();
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-06: the API's `type` enum used to be
  // omitted, so every advance was stored as "employee".
  it("sends the chosen advance type and the trimmed payee", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    renderPage(<NewAdvancePage />);
    fillForm();
    fireEvent.change(screen.getByLabelText("Payee"), { target: { value: "  Acme Traders  " } });
    fireEvent.change(screen.getByLabelText("Advance type"), { target: { value: "vendor" } });
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ type: "vendor", payee: "Acme Traders", purpose: "Tour advance" });
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-04: exponent / negative forms are rejected.
  it("rejects exponent and negative amounts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderPage(<NewAdvancePage />);
    fillForm();
    for (const bad of ["1e3", "-5", "0"]) {
      fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: bad } });
      fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
      expect(await screen.findByText(/at most 2 decimals/i)).toBeInTheDocument();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-02: a duplicate number surfaces inline.
  it("shows the server's duplicate-number message inline on the Advance number field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ code: "DUPLICATE_ADVANCE_NO", message: "x", fieldErrors: [{ field: "advanceNo", message: "This advance number is already in use. Enter a different number." }] }),
        { status: 409 },
      ),
    );
    renderPage(<NewAdvancePage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();
    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-05
  it("a 403 tells the officer they lack permission, not to try again", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Forbidden", { status: 403 }));
    renderPage(<NewAdvancePage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();
    const alert = await screen.findByText(/don't have permission/i);
    expect(alert.textContent).not.toMatch(/try again/i);
  });
});
