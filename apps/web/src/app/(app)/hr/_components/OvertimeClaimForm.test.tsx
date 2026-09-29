import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import { OvertimeClaimForm } from "./OvertimeClaimForm";

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/employee id/i), {
    target: { value: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
  });
  fireEvent.change(screen.getByLabelText(/date of overtime/i), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText(/hours worked ot/i), { target: { value: "2" } });
}

// Reset at the file level (not per-describe-block): pushMock is a single,
// module-scoped spy shared across every describe block below, so a reset
// nested inside only one of them would leave earlier blocks' calls (e.g.
// the Cancel-button tests) bleeding into later ones' assertions.
beforeEach(() => pushMock.mockReset());

describe("OvertimeClaimForm", () => {

  it("renders CCS Rules policy note", () => {
    render(<OvertimeClaimForm />);
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText(/CCS Rules/i)).toBeInTheDocument();
  });

  it("renders Employee ID, Date, and Hours fields", () => {
    render(<OvertimeClaimForm />);
    expect(screen.getByLabelText(/employee id/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date of overtime/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/hours worked ot/i)).toBeInTheDocument();
  });

  it("renders cash and comp-off radio buttons", () => {
    render(<OvertimeClaimForm />);
    expect(screen.getByLabelText(/cash payment/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/compensatory leave/i)).toBeInTheDocument();
  });

  it("defaults to cash compensation", () => {
    render(<OvertimeClaimForm />);
    expect(screen.getByLabelText(/cash payment/i)).toBeChecked();
  });

  it("allows switching to comp-off mode", () => {
    render(<OvertimeClaimForm />);
    const compOff = screen.getByLabelText(/compensatory leave/i);
    fireEvent.click(compOff);
    expect(compOff).toBeChecked();
  });

  it("renders duty officer and purpose fields", () => {
    render(<OvertimeClaimForm />);
    expect(screen.getByLabelText(/duty officer/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/purpose/i)).toBeInTheDocument();
  });

  it("renders Submit Claim and Cancel buttons", () => {
    render(<OvertimeClaimForm />);
    expect(screen.getByRole("button", { name: /submit claim/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("shows error when hours is 0 on submit", async () => {
    render(<OvertimeClaimForm />);
    fireEvent.change(screen.getByLabelText(/hours worked ot/i), { target: { value: "0" } });
    // Dispatch `submit` on the form directly rather than clicking the submit
    // button: the Hours field's `min="0.5"` and the other `required` fields
    // being empty would otherwise trip the browser's own constraint
    // validation on a real click and the submit handler (where the hours<=0
    // check actually lives) would never run.
    fireEvent.submit(screen.getByRole("form", { name: /overtime claim form/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("buttons have min 44px accessible touch targets via class", () => {
    render(<OvertimeClaimForm />);
    const btn = screen.getByRole("button", { name: /submit claim/i });
    expect(btn).toBeInTheDocument();
    // Style is set inline; check style attribute presence
    expect(btn).toHaveStyle({ minHeight: "44px" });
  });
});

/**
 * UX-016: this used to show the raw server `message` (falling back to
 * `Server error ${res.status}`) verbatim — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("OvertimeClaimForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw HTTP status, when submission fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    render(<OvertimeClaimForm />);
    fillRequiredFields();
    fireEvent.submit(screen.getByRole("form", { name: /overtime claim form/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("renders an inline field-level message from a fieldErrors response next to the offending field", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "hoursRequested", message: "Hours must be a valid number." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    render(<OvertimeClaimForm />);
    fillRequiredFields();
    fireEvent.submit(screen.getByRole("form", { name: /overtime claim form/i }));

    expect(await screen.findByText("Hours must be a valid number.")).toBeInTheDocument();
  });
});

/**
 * SF-15: the POST here is a 202-accepted async write -- the claim only
 * exists once the queue consumer runs, not the instant the POST resolves.
 * This proves the migrated form shows an explicit pending state and only
 * navigates once GET /overtime-requests actually confirms the new claim,
 * instead of the old fixed-950ms-then-redirect guess.
 */
describe("OvertimeClaimForm — SF-15 async confirmation", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows pending, then confirms via GET, then redirects — not a blind timeout", async () => {
    const createdId = "ot-1";
    // The first poll's response is held open under explicit test control so
    // the "pushMock not called yet" assertion is deterministic regardless
    // of real elapsed time / host speed.
    let resolveFirstPoll!: (r: Response) => void;
    const firstPoll = new Promise<Response>((resolve) => { resolveFirstPoll = resolve; });
    let pollCalls = 0;

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/overtime-requests") && init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ id: createdId, status: "pending" }), { status: 202 }),
        );
      }
      if (url.includes("/overtime-requests")) {
        pollCalls += 1;
        if (pollCalls === 1) return firstPoll; // queue consumer hasn't run yet
        return Promise.resolve(new Response(JSON.stringify({ data: [{ id: createdId }] }), { status: 200 }));
      }
      return Promise.reject(new Error("network"));
    });

    render(<OvertimeClaimForm />);
    fillRequiredFields();
    fireEvent.submit(screen.getByRole("form", { name: /overtime claim form/i }));

    // Pending state shown immediately -- not a premature "submitted" success.
    // Deterministic: the still-unresolved first poll makes confirmation
    // impossible so far.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/confirming/i));
    expect(pushMock).not.toHaveBeenCalledWith("/hr/workforce/overtime");

    // First poll: the claim isn't visible yet -- still not confirmed.
    resolveFirstPoll(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    expect(pushMock).not.toHaveBeenCalledWith("/hr/workforce/overtime");

    // Only once the claim genuinely appears on GET /overtime-requests does it redirect.
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/hr/workforce/overtime"), { timeout: 8000 });
  });
});
