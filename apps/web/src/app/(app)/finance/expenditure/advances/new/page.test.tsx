import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import NewAdvancePage from "./page";

function fillForm() {
  fireEvent.change(screen.getByLabelText("Advance number"), { target: { value: "ADV-001" } });
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Tour advance" } });
}

describe("NewAdvancePage", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("submits an advance (happy path, 202 accepted)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    render(<NewAdvancePage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));

    await waitFor(() => expect(screen.getByText("Advance recorded.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/finance/advances",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // UX-016: the shared `parseErrorMessage` helper used to build the message
  // from the backend's own `message`/`error` field, or (when the body
  // wasn't JSON) the RAW response text verbatim, falling back to a literal
  // `Request failed (${res.status})` -- the same class of leak
  // useFormError/toHumanError closes fleet-wide (UX-003).
  it("shows a clerk-safe message when submission fails, never the raw status or backend text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "insufficient_budget: head 2110 is over budget" }), { status: 422 }),
    );

    render(<NewAdvancePage />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/insufficient_budget/i);
    expect(alert.textContent).not.toMatch(/\b422\b/);
  });
});
