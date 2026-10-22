import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { TravelRequestForm } from "./TravelRequestForm";

// GAP-HR-TRAVEL-06: this component now renders through useTranslations
// (next-intl's client entry) -- every render needs a real
// NextIntlClientProvider, the same convention GrievancesTable.test.tsx /
// hr/advances/RequestAdvanceForm.test.tsx already established.
function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TravelRequestForm />
    </NextIntlClientProvider>,
  );
}

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Failed (${res.status})`) verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("TravelRequestForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function openAndFillForm() {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /new request/i }));
    fireEvent.change(screen.getByLabelText(/purpose/i), { target: { value: "Field inspection" } });
    fireEvent.change(screen.getByLabelText(/destination/i), { target: { value: "Pune" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-10-03" } });
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, when submission fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    openAndFillForm();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("never surfaces a raw server error message on a JSON error body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "travel-service: budget code invalid" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    openAndFillForm();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/Some details weren't accepted\. Check what you entered and try again\./));
    expect(alert.textContent).not.toMatch(/travel-service/);
  });
});

describe("TravelRequestForm — GAP-HR-TRAVEL-03 client validation parity", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a purpose shorter than 5 characters without a round trip (server requires min 5)", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /new request/i }));
    fireEvent.change(screen.getByLabelText(/purpose/i), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText(/destination/i), { target: { value: "Pune" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-10-03" } });
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));

    expect(await screen.findByText(/at least 5 characters/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers 'Own vehicle' as a mode option (the server enum already accepted it, the form never offered it)", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /new request/i }));
    expect(screen.getByRole("option", { name: /own vehicle/i })).toBeInTheDocument();
  });
});

describe("TravelRequestForm — GAP-HR-TRAVEL-05 paise-safe money", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "t1", status: "pending" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("converts a decimal rupee amount to paise without float drift", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /new request/i }));
    fireEvent.change(screen.getByLabelText(/purpose/i), { target: { value: "Field inspection" } });
    fireEvent.change(screen.getByLabelText(/destination/i), { target: { value: "Pune" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-10-03" } });
    fireEvent.change(screen.getByLabelText(/advance/i), { target: { value: "1234.50" } });
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.advanceRequired).toBe(123450);
  });

  function fillWithAdvance(advance: string) {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /new request/i }));
    fireEvent.change(screen.getByLabelText(/purpose/i), { target: { value: "Field inspection" } });
    fireEvent.change(screen.getByLabelText(/destination/i), { target: { value: "Pune" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-10-03" } });
    fireEvent.change(screen.getByLabelText(/advance/i), { target: { value: advance } });
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
  }

  it("1234.5 is sent as 123450 paise", async () => {
    fillWithAdvance("1234.5");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.advanceRequired).toBe(123450);
  });

  // GAP-HR-TRAVEL-05 acceptance: '0' -> 0. rupeesToMinorString returns null for
  // zero unless allowZero is set, so a typed 0 used to be rejected as invalid
  // even though the route (advanceRequired: int >= 0) accepts it.
  it("an advance of 0 is accepted and sent as 0", async () => {
    fillWithAdvance("0");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.advanceRequired).toBe(0);
    expect(screen.queryByText(/valid amount/i)).toBeNull();
  });

  it("1.005 (sub-paise) is rejected with the field error and never sent", async () => {
    fillWithAdvance("1.005");
    expect(await screen.findByText(/valid amount/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a blank advance is omitted from the body (no advance requested), distinct from 0", async () => {
    fillWithAdvance("");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("advanceRequired");
  });
});
