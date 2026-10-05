import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
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
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders the DPDP purpose notice for contact details", () => {
    render(withIntl(<NewServiceRequestPage />));
    expect(screen.getByText(/Digital Personal\s+Data Protection Act, 2023/i)).toBeInTheDocument();
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
});
