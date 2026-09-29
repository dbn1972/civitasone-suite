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

  /**
   * SF-15: previously mocked every fetch() call (POST and any later reads
   * alike) with the same bare 202 body and just asserted `pushMock` fired
   * after a fixed 950ms sleep -- exactly the "assume the async write has
   * landed by now" guess this fix replaces. Real behavior: the POST is
   * accepted (202) before the queued write has actually run, so the new
   * request is not yet visible on GET /shift-requests; the form must show
   * an explicit pending/confirming state and keep polling until it is, and
   * only navigate once that's genuinely true.
   */
  it("submits the real backend contract, shows pending, confirms via GET, then redirects", async () => {
    const createdId = "sr-1";
    // The first poll's response is held open under explicit test control so
    // the "pushMock not called yet" assertion is deterministic regardless
    // of real elapsed time / host speed.
    let resolveFirstPoll!: (r: Response) => void;
    const firstPoll = new Promise<Response>((resolve) => { resolveFirstPoll = resolve; });
    let pollCalls = 0;

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/shift-requests") && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ id: createdId, status: "pending" }), { status: 202 }));
      }
      if (url.includes("/shift-requests")) {
        pollCalls += 1;
        if (pollCalls === 1) return firstPoll; // queue consumer hasn't run yet
        return Promise.resolve(new Response(JSON.stringify({ data: [{ id: createdId }] }), { status: 200 }));
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
    const call = fetchMock.mock.calls.find((args: unknown[]) => String(args[0]).includes("/shift-requests") && (args[1] as RequestInit | undefined)?.method === "POST");
    const body = JSON.parse((call as [string, RequestInit])[1].body as string);
    expect(body).toEqual({
      employeeId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      currentShift: "General Duty",
      requestedShift: "Morning Shift",
      effectiveDate: "2026-10-01",
      reason: "Childcare schedule",
    });

    // Pending state shown immediately -- not a premature "submitted"
    // success -- while the write is still unconfirmed. Deterministic: the
    // still-unresolved first poll makes confirmation impossible so far.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/confirming/i));
    expect(pushMock).not.toHaveBeenCalledWith("/hr/shift-requests");

    // First poll: the request isn't visible yet -- still not confirmed.
    resolveFirstPoll(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    expect(pushMock).not.toHaveBeenCalledWith("/hr/shift-requests");

    // Only once the id genuinely appears on GET /shift-requests does it redirect.
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/hr/shift-requests"), { timeout: 8000 });
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
