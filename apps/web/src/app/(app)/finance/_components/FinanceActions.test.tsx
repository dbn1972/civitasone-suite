import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ToastProvider } from "@/app/_components/ds";
import { PaymentActions, SanctionApproveAction } from "./FinanceActions";

/**
 * L3 (money truthfulness): finance maker-checker commands return 202 Accepted
 * (queued, not done). Previously onSuccess only refreshed the route, so the
 * dialog closed over an unchanged page with no confirmation — the officer could
 * not tell the submission was accepted and might re-submit. Success must be
 * confirmed with an honest "submitted" message.
 */
describe("FinanceActions confirms an accepted (202) submission", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("shows a 'submitted' toast after a 202, and refreshes", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));

    render(
      <ToastProvider>
        <SanctionApproveAction id="s1" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve sanction" }));
    await waitFor(() => expect(screen.getByText("Approve this sanction?")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Approving authority & reason"), {
      target: { value: "DDO / office contingency" },
    });
    fireEvent.click(screen.getByText("Approve"));

    await waitFor(() =>
      expect(screen.getByText("Approval submitted — the sanction status updates once processing completes.")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/finance/sanctions/s1/approve",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(refreshMock).toHaveBeenCalled();
  });
});

/**
 * UX-016: postJson/patchJson used to build the confirm-dialog error message
 * by hand -- a literal "Request failed (${res.status})." fallback, or (when
 * the body wasn't JSON) the RAW response text verbatim. Both are the same
 * class of leak useFormError/toHumanError closes fleet-wide (UX-003). This
 * proves the fix: a failed submit shows a clerk-safe catalogued message,
 * never the raw status or raw body text.
 */
describe("FinanceActions surfaces a clerk-safe error on a failed submission", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message on the confirm dialog, never the raw status or body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    );

    render(
      <ToastProvider>
        <SanctionApproveAction id="s1" />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve sanction" }));
    await waitFor(() => expect(screen.getByText("Approve this sanction?")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Approving authority & reason"), {
      target: { value: "DDO / office contingency" },
    });
    fireEvent.click(screen.getByText("Approve"));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/502/);
    expect(alert.textContent).not.toMatch(/Bad Gateway/i);
    expect(alert.textContent).not.toMatch(/request failed/i);
  });
});

// GAP-FINANCE-PAYMENTS-07 (review H2): the PFMS sync endpoint does not exist, so the control is an
// honest disabled button -- no confirm dialog, no POST, no "may move funds" copy.
describe("PFMS Sync is unavailable until a real sync route exists", () => {
  it("renders a disabled 'Not available yet' button that makes no request", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<PaymentActions />);
    const btn = screen.getByRole("button", { name: /Not available yet/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/move funds/i)).not.toBeInTheDocument();
  });
});
