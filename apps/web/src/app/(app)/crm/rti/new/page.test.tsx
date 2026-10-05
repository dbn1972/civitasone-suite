import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import NewRtiPage from "./page";

describe("NewRtiPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  // Regression test for the CRITICAL bug: the form posted to
  // fetch("/api/v1/crm/rti") instead of the only working client-mutation
  // prefix "/api/proxy/v1/crm/rti" — an RTI application could never actually
  // be filed, the request 404'd against the Next.js app itself every time.
  it("files the RTI request against the correct proxied endpoint and navigates to it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "new-rti-1" } }), { status: 201 }),
    );

    render(<NextIntlClientProvider locale="en" messages={enMessages}><NewRtiPage /></NextIntlClientProvider>);
    fireEvent.change(screen.getByLabelText(/^section/i), { target: { value: "s.6" } });
    fireEvent.change(screen.getByLabelText(/department \/ public authority/i), { target: { value: "Ministry of Finance" } });
    fireEvent.change(screen.getByLabelText(/^subject/i), { target: { value: "Copy of sanctioned budget" } });
    fireEvent.change(screen.getByLabelText(/description \/ particulars sought/i), { target: { value: "Please provide the FY26 budget breakup." } });
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Anil Sharma" } });
    fireEvent.click(screen.getByRole("button", { name: "File RTI Request" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/rti/new-rti-1"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/crm/rti");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.section).toBe("s.6");
    expect(body.departmentRef).toBe("Ministry of Finance");
    expect(body.applicantName).toBe("Anil Sharma");
  });

  // UX-016: this used to surface the backend's raw `message` field (or a
  // bare `HTTP ${status}` fallback) verbatim. It must now show only the
  // catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error instead of the raw server text, and does not navigate away, on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Description is required" }), { status: 422 }),
    );

    render(<NextIntlClientProvider locale="en" messages={enMessages}><NewRtiPage /></NextIntlClientProvider>);
    fireEvent.change(screen.getByLabelText(/^section/i), { target: { value: "s.6" } });
    fireEvent.change(screen.getByLabelText(/department \/ public authority/i), { target: { value: "Ministry of Finance" } });
    fireEvent.change(screen.getByLabelText(/^subject/i), { target: { value: "Copy of sanctioned budget" } });
    fireEvent.change(screen.getByLabelText(/description \/ particulars sought/i), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Anil Sharma" } });
    fireEvent.click(screen.getByRole("button", { name: "File RTI Request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Some details weren't accepted\. Check what you entered and try again\./);
    expect(screen.queryByText("Description is required")).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  function fillRequired() {
    fireEvent.change(screen.getByLabelText(/^section/i), { target: { value: "s.6" } });
    fireEvent.change(screen.getByLabelText(/department \/ public authority/i), { target: { value: "Ministry of Finance" } });
    fireEvent.change(screen.getByLabelText(/^subject/i), { target: { value: "Copy of sanctioned budget" } });
    fireEvent.change(screen.getByLabelText(/description \/ particulars sought/i), { target: { value: "Please provide the FY26 budget breakup." } });
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Anil Sharma" } });
  }

  // GAP-CRM-RTI-NEW-02: a received date and mode of receipt are collected and
  // sent, so the 30-day clock starts from the real date of receipt.
  it("sends receivedDate and mode of receipt when supplied", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "r1" } }), { status: 201 }),
    );
    render(<NextIntlClientProvider locale="en" messages={enMessages}><NewRtiPage /></NextIntlClientProvider>);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/date of receipt/i), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText(/mode of receipt/i), { target: { value: "post" } });
    fireEvent.click(screen.getByRole("button", { name: "File RTI Request" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/rti/r1"));
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.receivedDate).toBe("2026-09-20");
    expect(body.mode).toBe("post");
  });

  // GAP-CRM-RTI-NEW-01: the fee is sent as paise (feeAmountMinor), not a rupees
  // JSON float. 10.10 -> "1010", and the legacy rupees `feeAmount` is gone.
  it("sends the fee as paise (feeAmountMinor), never a rupees float", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "r2" } }), { status: 201 }),
    );
    render(<NextIntlClientProvider locale="en" messages={enMessages}><NewRtiPage /></NextIntlClientProvider>);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/fee amount/i), { target: { value: "10.10" } });
    fireEvent.click(screen.getByRole("button", { name: "File RTI Request" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/rti/r2"));
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.feeAmountMinor).toBe("1010");
    expect(body.feeAmount).toBeUndefined();
  });

  // GAP-CRM-RTI-NEW-01: a sub-paise fee (3+ decimals) is rejected client-side
  // rather than silently rounded.
  it("blocks a fee with more than 2 decimals and does not submit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NextIntlClientProvider locale="en" messages={enMessages}><NewRtiPage /></NextIntlClientProvider>);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/fee amount/i), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: "File RTI Request" }));

    expect(await screen.findByText(/up to 2 decimal places/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-RTI-NEW-03: an invalid contact is caught before submit.
  it("blocks an invalid contact and does not submit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NextIntlClientProvider locale="en" messages={enMessages}><NewRtiPage /></NextIntlClientProvider>);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/contact \(phone \/ email\)/i), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "File RTI Request" }));

    expect(await screen.findByText(/valid 10-digit Indian mobile number or an email/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("accepts a valid Indian mobile and a valid email as contact", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "r3" } }), { status: 201 }),
    );
    render(<NextIntlClientProvider locale="en" messages={enMessages}><NewRtiPage /></NextIntlClientProvider>);
    fillRequired();
    fireEvent.change(screen.getByLabelText(/contact \(phone \/ email\)/i), { target: { value: "9876500000" } });
    fireEvent.click(screen.getByRole("button", { name: "File RTI Request" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/rti/r3"));
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.applicantContact).toBe("9876500000");
  });

  // GAP-CRM-RTI-NEW-03: a DPDP purpose / lawful-basis notice is visible.
  it("shows a DPDP purpose notice in the Applicant Details section", () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><NewRtiPage /></NextIntlClientProvider>);
    expect(screen.getByText(/used only to process this request under the/i)).toBeInTheDocument();
    expect(screen.getByText(/DPDP Act 2023/)).toBeInTheDocument();
  });
});
