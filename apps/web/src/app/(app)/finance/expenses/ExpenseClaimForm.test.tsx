import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ExpenseClaimForm } from "./ExpenseClaimForm";

function fillForm() {
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "Stationery for DDO office" } });
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "500" } });
}

describe("ExpenseClaimForm", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("submits an expense claim (happy path)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    render(<ExpenseClaimForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /submit claim/i }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/DDO countersignature/));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/finance/expenses",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // UX-016: the failed-response branch used to build the message from the
  // backend's own `message`/`error` field, or (when the body wasn't JSON)
  // the RAW response text verbatim, falling back to a literal
  // `Submission failed (${res.status})` -- the same class of leak
  // useFormError/toHumanError closes fleet-wide (UX-003). The catch block
  // also used to show the exception's own message (`String(err)`) directly.
  it("shows a clerk-safe message when submission fails, never the raw status or backend text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "ddo_mismatch: claimant is not under this DDO" }), { status: 422 }),
    );

    render(<ExpenseClaimForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /submit claim/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/ddo_mismatch/i);
    expect(alert.textContent).not.toMatch(/\b422\b/);
  });
});
