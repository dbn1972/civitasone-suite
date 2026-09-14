import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import OvertimeNewPage from "./page";

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Error ${res.status}`) verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("OvertimeNewPage — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function fillAndSubmit() {
    render(<OvertimeNewPage />);
    fireEvent.change(screen.getByLabelText(/employee id/i), {
      target: { value: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
    });
    fireEvent.change(screen.getByLabelText(/date of overtime/i), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText(/hours requested/i), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, when submission fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    fillAndSubmit();

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/\b500\b/)).not.toBeInTheDocument();
  });

  it("renders an inline field-level message from a fieldErrors response next to the offending field", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "employeeId", message: "Employee not found." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    fillAndSubmit();

    expect(await screen.findByText("Employee not found.")).toBeInTheDocument();
  });
});
