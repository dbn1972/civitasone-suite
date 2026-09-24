import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import { ShiftChangeRequestForm } from "./ShiftChangeRequestForm";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

/**
 * CRITICAL fix: this form did not exist at all -- the shift-change feature
 * was entirely view-only despite POST /v1/hrms/shift-requests already
 * working (WAVE-4). Real contract per attendance/routes.ts: { employeeId,
 * currentShift, requestedShift, effectiveDate, reason? }.
 */
describe("ShiftChangeRequestForm", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    pushMock.mockReset();
    fetchMock.mockReset();
    // Default: both the employees picker and the shifts catalogue fetch
    // fail gracefully to plain inputs unless a test overrides this.
    fetchMock.mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders the required fields", () => {
    render(<ShiftChangeRequestForm />);
    expect(screen.getByLabelText(/current shift/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/requested shift/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/effective date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/reason/i)).toBeInTheDocument();
  });

  it("shows the employee id input when no prefill is given", () => {
    render(<ShiftChangeRequestForm />);
    expect(screen.getByLabelText(/employee/i)).toBeInTheDocument();
  });

  it("hides the employee picker when a prefill id is given (self-service)", () => {
    render(<ShiftChangeRequestForm employeeId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />);
    expect(screen.queryByLabelText(/^employee/i)).not.toBeInTheDocument();
  });

  it("rejects submitting the same shift as current and requested", async () => {
    render(<ShiftChangeRequestForm employeeId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />);
    fireEvent.change(screen.getByLabelText(/current shift/i), { target: { value: "General Duty" } });
    fireEvent.change(screen.getByLabelText(/requested shift/i), { target: { value: "General Duty" } });
    fireEvent.change(screen.getByLabelText(/effective date/i), { target: { value: "2026-10-01" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("form"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/different/i);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/proxy/v1/hrms/shift-requests", expect.anything());
  });

  it("submits the real backend contract and redirects on success", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/shift-requests")) {
        return Promise.resolve(new Response(JSON.stringify({ id: "sr-1", status: "pending" }), { status: 202 }));
      }
      return Promise.reject(new Error("network"));
    });
    render(<ShiftChangeRequestForm employeeId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" redirectHref="/hr/shift-requests" />);

    fireEvent.change(screen.getByLabelText(/current shift/i), { target: { value: "General Duty" } });
    fireEvent.change(screen.getByLabelText(/requested shift/i), { target: { value: "Morning Shift" } });
    fireEvent.change(screen.getByLabelText(/effective date/i), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Childcare schedule" } });

    await act(async () => {
      fireEvent.submit(screen.getByRole("form"));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/shift-requests",
      expect.objectContaining({ method: "POST" }),
    ));
    const call = fetchMock.mock.calls.find((args: unknown[]) => String(args[0]).includes("/shift-requests"));
    const body = JSON.parse((call as [string, RequestInit])[1].body as string);
    expect(body).toEqual({
      employeeId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      currentShift: "General Duty",
      requestedShift: "Morning Shift",
      effectiveDate: "2026-10-01",
      reason: "Childcare schedule",
    });

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/submitted/i));
    await new Promise((r) => setTimeout(r, 950));
    expect(pushMock).toHaveBeenCalledWith("/hr/shift-requests");
  });

  it("shows a clerk-safe error, never the raw HTTP status, on failure", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/shift-requests")) {
        return Promise.resolve(new Response("", { status: 500 }));
      }
      return Promise.reject(new Error("network"));
    });
    render(<ShiftChangeRequestForm employeeId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />);

    fireEvent.change(screen.getByLabelText(/current shift/i), { target: { value: "General Duty" } });
    fireEvent.change(screen.getByLabelText(/requested shift/i), { target: { value: "Morning Shift" } });
    fireEvent.change(screen.getByLabelText(/effective date/i), { target: { value: "2026-10-01" } });

    await act(async () => {
      fireEvent.submit(screen.getByRole("form"));
    });

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});
