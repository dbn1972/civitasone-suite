import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";

import type { ReactElement } from "react";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}


const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import NewServiceRequestPage from "./page";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function withIntl(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

// The form loads the service-type master (GAP-CRM-SERVICE-REQUESTS-NEW-02) and
// may load a contact lookup on mount, so there can be GET calls before the
// submit. This helper picks the service-request POST call specifically.
function postCall(fetchSpy: { mock: { calls: unknown[][] } }) {
  return fetchSpy.mock.calls.find(
    (call) => (call[1] as RequestInit | undefined)?.method === "POST",
  ) as [RequestInfo | URL, RequestInit] | undefined;
}

describe("NewServiceRequestPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("submits the new service request to the correct proxied endpoint and navigates to it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "new-sr-1" } }), { status: 201 }),
    );

    render(withIntl(<NewServiceRequestPage />));
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Birth Certificate" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Need birth certificate" } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/service-requests/new-sr-1"));

    const call = postCall(fetchSpy);
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe("/api/proxy/v1/crm/service-requests");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.citizenName).toBe("Meera Devi");
    expect(body.serviceType).toBe("Birth Certificate");
    expect(body.citizenPhone).toBe("9876543210");
  });

  // GAP-CRM-SERVICE-REQUESTS-NEW-01 (DPDP + reachability): a request with
  // neither phone nor email must be blocked client-side with an inline error,
  // and must not hit the API.
  it("blocks submit and shows an error when both phone and email are blank", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "x" } }), { status: 201 }),
    );

    render(withIntl(<NewServiceRequestPage />));
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Birth Certificate" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Need birth certificate" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/phone number or an email/i);
    // The mount-time master GET may fire, but no service-request POST must be made.
    expect(postCall(fetchSpy)).toBeUndefined();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders the DPDP purpose notice for contact details", () => {
    render(withIntl(<NewServiceRequestPage />));
    expect(screen.getByText(/Digital Personal\s+Data Protection Act, 2023/i)).toBeInTheDocument();
  });

  // GAP-CRM-SERVICE-REQUESTS-NEW-03: the form captures intake channel and an
  // optional target resolution date, and sends them to the API.
  it("sends intake channel and target resolution date when provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "sr-c" } }), { status: 201 }),
    );

    render(<NewServiceRequestPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Birth Certificate" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Need birth certificate" } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9876543210" } });
    fireEvent.change(screen.getByLabelText(/received via/i), { target: { value: "walk_in" } });
    fireEvent.change(screen.getByLabelText(/target resolution date/i), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const [, init] = postCall(fetchSpy)!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.intakeChannel).toBe("walk_in");
    expect(body.dueAt).toBe("2026-10-20T00:00:00.000Z");
  });

  it("omits intake channel and target date when left blank", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "sr-d" } }), { status: 201 }),
    );

    render(<NewServiceRequestPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Birth Certificate" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Need birth certificate" } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const [, init] = postCall(fetchSpy)!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.intakeChannel).toBeUndefined();
    expect(body.dueAt).toBeUndefined();
  });

  // UX-016: this used to surface the backend's raw `message` field (or a
  // bare `HTTP ${status}` fallback) verbatim. It must now show only the
  // catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error instead of the raw server text, and does not navigate away, on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Service type required" }), { status: 422 }),
    );

    render(withIntl(<NewServiceRequestPage />));
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Birth Certificate" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Need birth certificate" } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Some details weren't accepted\. Check what you entered and try again\./);
    expect(screen.queryByText("Service type required")).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-SERVICE-REQUESTS-NEW-02: the select is fed by the per-tenant
  // service-type master. A configured active type appears as an option.
  it("offers the tenant's configured service types from the master", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/crm/service-types")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "t1", code: "ration_card", label: "Ration Card", active: true, sortOrder: 0 }] }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ data: { id: "x" } }), { status: 201 }));
    });

    render(<NewServiceRequestPage />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Ration Card" })).toBeInTheDocument());
    // The master was non-empty, so the fallback notice is NOT shown.
    expect(screen.queryByText(/standard service-type list/i)).not.toBeInTheDocument();
  });

  // GAP-CRM-SERVICE-REQUESTS-NEW-02: a failed master load falls back to the
  // standard list with an inline notice — never an empty select, no crash.
  it("falls back to the standard service-type list with a notice when the master fails to load", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/crm/service-types")) {
        return Promise.resolve(new Response("{}", { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: { id: "x" } }), { status: 201 }));
    });

    render(<NewServiceRequestPage />);
    expect(await screen.findByText(/standard service-type list/i)).toBeInTheDocument();
    // Standard options are still present, so the select is never empty.
    expect(screen.getByRole("option", { name: "Birth Certificate" })).toBeInTheDocument();
  });

  // GAP-CRM-SERVICE-REQUESTS-NEW-04: an async contact-search picker links an
  // existing contact; the chosen contactId is sent on the request.
  it("offers an async contact search picker and sends the chosen contactId", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/crm/contacts/lookup")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "ct-9", name: "Meera Devi", phone: "98xxxx3210" }] }), { status: 200 }),
        );
      }
      if (url.includes("/v1/crm/service-types")) {
        return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: { id: "sr-link" } }), { status: 201 }));
    });

    render(<NewServiceRequestPage />);
    const picker = screen.getByRole("combobox", { name: /link existing contact/i });
    fireEvent.change(picker, { target: { value: "Meera" } });
    const option = await screen.findByText("Meera Devi");
    fireEvent.mouseDown(option);

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Birth Certificate" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Need birth certificate" } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/service-requests/sr-link"));
    const call = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.contactId).toBe("ct-9");
  });

  // GAP-CRM-SERVICE-REQUESTS-NEW-05: a malformed phone is blocked client-side
  // with a per-field error, and no request is sent.
  it("blocks a malformed phone and does not POST", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "x" } }), { status: 201 }),
    );

    render(<NewServiceRequestPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Birth Certificate" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Need birth certificate" } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

    expect(await screen.findByText(/valid 10-digit Indian mobile number/i)).toBeInTheDocument();
    expect(postCall(fetchSpy)).toBeUndefined();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-SERVICE-REQUESTS-NEW-05: a +91-prefixed, spaced mobile is accepted
  // and normalised to its 10 digits before sending.
  it("accepts a +91-prefixed mobile and sends the normalised 10 digits", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "sr-norm" } }), { status: 201 }),
    );

    render(<NewServiceRequestPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Birth Certificate" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Need birth certificate" } });
    fireEvent.change(screen.getByLabelText(/^Phone/), { target: { value: "+91 98765 43210" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/service-requests/sr-norm"));
    const [, init] = postCall(fetchSpy)!;
    expect(JSON.parse((init as RequestInit).body as string).citizenPhone).toBe("9876543210");
  });

  // GAP-CRM-SERVICE-REQUESTS-NEW-05: a malformed email is blocked (native email
  // constraint and the JS guard both prevent the request).
  it("blocks a malformed email and does not POST", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "x" } }), { status: 201 }),
    );

    render(<NewServiceRequestPage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Meera Devi" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Birth Certificate" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "Need birth certificate" } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Request" }));

    await waitFor(() => expect(pushMock).not.toHaveBeenCalled());
    expect(postCall(fetchSpy)).toBeUndefined();
  });
});
