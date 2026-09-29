import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import { WFHRequestForm } from "./WFHRequestForm";

// This component calls useTranslations() directly, which needs a real
// NextIntlClientProvider in the tree -- every render() call below was
// previously unwrapped, so every test in this file failed outright with
// "Failed to call `useTranslations` because the context from
// `NextIntlClientProvider` was not found" (a pre-existing gap, unrelated to
// the redirectHref prop this fix adds, surfaced while fixing that).
function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

// Reset at the file level (not per-describe-block): pushMock is a single,
// module-scoped spy shared across every describe block below, so a reset
// nested inside only one of them would leave earlier blocks' calls (e.g.
// the Cancel-button tests) bleeding into later ones' assertions.
beforeEach(() => pushMock.mockReset());

describe("WFHRequestForm", () => {

  it("renders DoPT policy note", () => {
    render(<WFHRequestForm />);
    const notes = screen.getAllByRole("note");
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/2 days per week/i)).toBeInTheDocument();
  });

  it("renders From Date and To Date fields", () => {
    render(<WFHRequestForm />);
    expect(screen.getByLabelText(/from date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/to date/i)).toBeInTheDocument();
  });

  it("renders Reason textarea", () => {
    render(<WFHRequestForm />);
    expect(screen.getByLabelText(/reason/i)).toBeInTheDocument();
  });

  it("renders Submit and Cancel buttons", () => {
    render(<WFHRequestForm />);
    expect(screen.getByRole("button", { name: /submit request/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("shows employee UUID input when no prefill", () => {
    render(<WFHRequestForm />);
    expect(screen.getByLabelText(/employee id/i)).toBeInTheDocument();
  });

  it("hides employee UUID input when prefill provided", () => {
    render(<WFHRequestForm employeeId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />);
    expect(screen.queryByLabelText(/employee id/i)).not.toBeInTheDocument();
  });

  it("shows validation error when To date before From date", async () => {
    render(<WFHRequestForm />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-08-20" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-08-15" } });
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: /work from home request form/i }));
    });
    const alerts = screen.getAllByRole("alert");
    const dateErr = alerts.find(el => /cannot be before/i.test(el.textContent ?? ""));
    expect(dateErr).toBeTruthy();
  });

  it("submit button is accessible with aria-busy when submitting", () => {
    render(<WFHRequestForm />);
    const btn = screen.getByRole("button", { name: /submit request/i });
    expect(btn).toHaveAttribute("aria-busy", "false");
  });

  // DoPT OM 2022 eligibility gate tests

  it("disables submit and shows gazetted error for employee at Level > 10", () => {
    render(<WFHRequestForm payLevel={11} weeklyWfhCount={0} />);
    const banner = screen.getByTestId("gazetted-error");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/Level 1.10.*DoPT OM 2022/i);
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
  });

  it("disables submit and shows weekly cap error for eligible employee at 2-day limit", () => {
    render(<WFHRequestForm payLevel={7} weeklyWfhCount={2} />);
    const banner = screen.getByTestId("weekly-cap-error");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/2-day weekly WFH limit reached/i);
    expect(screen.getByRole("button", { name: /submit request/i })).toBeDisabled();
  });

  it("enables submit for eligible employee under weekly cap", () => {
    render(<WFHRequestForm payLevel={5} weeklyWfhCount={1} />);
    expect(screen.queryByTestId("gazetted-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("weekly-cap-error")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit request/i })).not.toBeDisabled();
  });

  it("shows pay-level unknown warning and allows submit when payLevel is not provided", () => {
    render(<WFHRequestForm weeklyWfhCount={0} />);
    expect(screen.getByTestId("paylevel-warning")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit request/i })).not.toBeDisabled();
  });

  // CRITICAL fix: redirectHref used to be hardcoded to /hr/workforce/wfh
  // (role-gated, excluding `employee`), so embedding this form on the
  // all-roles /hr/wfh page sent every submitter -- including the plain
  // employees that page is for -- straight into a permission wall on
  // Cancel or after a successful submit.
  //
  // HRMS peripheral medium findings, item 1: /hr/workforce/wfh is now
  // itself a redirect stub to /hr/wfh (it was an orphaned duplicate page
  // with zero inbound links), so the default was repointed straight at the
  // canonical route to avoid a pointless extra redirect hop.
  it("Cancel navigates to the default redirectHref (/hr/wfh) when not overridden", () => {
    render(<WFHRequestForm />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(pushMock).toHaveBeenCalledWith("/hr/wfh");
  });

  it("Cancel navigates to a custom redirectHref when provided", () => {
    render(<WFHRequestForm redirectHref="/hr/wfh" />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(pushMock).toHaveBeenCalledWith("/hr/wfh");
  });
});

/**
 * UX-016: this used to show the raw server `message` (falling back to
 * `Server error ${res.status}`) verbatim — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("WFHRequestForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function submitValidForm(props: { redirectHref?: string } = {}) {
    render(<WFHRequestForm payLevel={5} weeklyWfhCount={0} {...props} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/employee id/i), {
        target: { value: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-09-20" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-09-21" } });
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: /work from home request form/i }));
    });
  }

  it("shows a clerk-safe message, never the raw HTTP status, when submission fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await submitValidForm();

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
          fieldErrors: [{ field: "fromDate", message: "From date cannot be in the past." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    await submitValidForm();

    expect(await screen.findByText("From date cannot be in the past.")).toBeInTheDocument();
  });

  /**
   * SF-15: this used to mock every fetch() call (POST and any later reads
   * alike) with the same bare 202 body, and just assert `pushMock` fired
   * after a fixed 950ms sleep -- exactly the "assume the async write has
   * landed by now" guess this fix replaces. Real behavior: the POST is
   * accepted (202) before the queued write has actually run, so the new
   * request is not yet visible on GET /wfh-requests; the form must show an
   * explicit pending/confirming state and keep polling until it is, and
   * only navigate once that's genuinely true.
   */
  it("shows pending, then confirms via GET /wfh-requests, then redirects — not a blind timeout", async () => {
    const createdId = "wfh-1";
    // The first poll's response is held open under explicit test control
    // (rather than just returning a "not found yet" list immediately) so
    // the "pushMock not called yet" assertion below is deterministic
    // regardless of real elapsed time / host speed -- it cannot possibly
    // fire until this promise is resolved, however long that takes.
    let resolveFirstPoll!: (r: Response) => void;
    const firstPoll = new Promise<Response>((resolve) => { resolveFirstPoll = resolve; });
    let pollCalls = 0;

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/wfh-requests") && init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ id: createdId, status: "pending" }), { status: 202 }),
        );
      }
      if (url.includes("/wfh-requests")) {
        pollCalls += 1;
        if (pollCalls === 1) return firstPoll; // queue consumer hasn't run yet
        return Promise.resolve(new Response(JSON.stringify({ data: [{ id: createdId }] }), { status: 200 }));
      }
      return Promise.reject(new Error("network"));
    });

    await submitValidForm({ redirectHref: "/hr/wfh" });

    // Pending state shown immediately -- not the old data, not a premature
    // "submitted" success -- while the write is still unconfirmed. Safe to
    // assert deterministically: nothing can confirm before the (still
    // unresolved) first poll settles.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/confirming/i));
    expect(pushMock).not.toHaveBeenCalledWith("/hr/wfh");

    // First poll: the request isn't visible yet -- still not confirmed.
    resolveFirstPoll(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    expect(pushMock).not.toHaveBeenCalledWith("/hr/wfh");

    // Only once the id genuinely appears in the list does it redirect.
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/hr/wfh"), { timeout: 8000 });
  });
});
