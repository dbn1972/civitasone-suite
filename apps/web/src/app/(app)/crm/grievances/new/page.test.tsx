import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

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

import NewGrievancePage from "./page";

describe("NewGrievancePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  // Regression test for the CRITICAL bug: the form posted to
  // fetch("/api/v1/crm/grievances") instead of the only working
  // client-mutation prefix "/api/proxy/v1/crm/grievances" — a citizen could
  // never actually file a grievance, the request 404'd against the Next.js
  // app itself every time.
  it("submits the new grievance to the correct proxied endpoint and navigates to it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "new-grievance-1" } }), { status: 201 }),
    );

    render(<NewGrievancePage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "No water for 3 days" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/grievances/new-grievance-1"));

    // The form also loads the category master (GAP-CRM-GRIEVANCES-NEW-03) on
    // mount, so there may be a GET before the submit — assert on the POST call
    // specifically rather than a bare call count.
    const postCall = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCall).toBeDefined();
    const [url, init] = postCall!;
    expect(url).toBe("/api/proxy/v1/crm/grievances");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.citizenName).toBe("Ravi Kumar");
    expect(body.category).toBe("Water Supply");
  });

  // UX-016: this used to surface the backend's raw `message` field (or a
  // bare `HTTP ${status}` fallback) verbatim. It must now show only the
  // catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error instead of the raw server text, and does not navigate away, on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Invalid category" }), { status: 422 }),
    );

    render(<NewGrievancePage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "No water for 3 days" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Some details weren't accepted\. Check what you entered and try again\./);
    expect(screen.queryByText("Invalid category")).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-GRIEVANCES-NEW-01 — the DPDP purpose/retention notice is visible.
  it("shows the DPDP purpose notice for citizen contact data", () => {
    render(<NewGrievancePage />);
    expect(screen.getByText(/used only to respond to this grievance/i)).toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-NEW-01 — an invalid phone blocks submit with an inline
  // message and never fires the request.
  it("blocks submit and shows an inline error for an invalid phone", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<NewGrievancePage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "No water" } });
    fireEvent.change(screen.getByLabelText(/^phone$/i), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));

    expect(await screen.findByText(/valid phone number/i)).toBeInTheDocument();
    // The mount-time category-master GET may fire, but no grievance POST must be made.
    const postCall = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCall).toBeUndefined();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-GRIEVANCES-NEW-02 — a server rejection for citizenEmail renders
  // beside the Email field, not just the top banner.
  it("renders a server field error for citizenEmail beside the Email field", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ code: "VALIDATION_FAILED", message: "validation", fieldErrors: [{ field: "citizenEmail", message: "Email already used" }] }),
        { status: 422 },
      ),
    );

    render(<NewGrievancePage />);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Water Supply" } });
    fireEvent.change(screen.getByLabelText(/subject/i), { target: { value: "No water" } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Grievance" }));

    expect(await screen.findByText("Email already used")).toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-NEW-03: the select is fed by the per-tenant category
  // master. A configured active category appears as an option.
  it("offers the tenant's configured categories from the master", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/crm/grievance-categories")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "c1", code: "noise", label: "Noise Pollution", active: true, sortOrder: 0 }] }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ data: { id: "x" } }), { status: 201 }));
    });

    render(<NewGrievancePage />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Noise Pollution" })).toBeInTheDocument());
    expect(screen.queryByText(/standard category list/i)).not.toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-NEW-03: a failed master load falls back to the standard
  // CPGRAMS-aligned list with an inline notice — never an empty select.
  it("falls back to the standard category list with a notice when the master fails to load", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/crm/grievance-categories")) {
        return Promise.resolve(new Response("{}", { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ data: { id: "x" } }), { status: 201 }));
    });

    render(<NewGrievancePage />);
    expect(await screen.findByText(/standard category list/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Water Supply" })).toBeInTheDocument();
  });
});
