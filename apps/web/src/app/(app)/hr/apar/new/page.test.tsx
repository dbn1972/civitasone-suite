import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import AparNewPage from "./page";

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Error ${res.status}`) verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("AparNewPage — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function fillAndSubmit() {
    fireEvent.change(screen.getByLabelText(/employee id/i), {
      target: { value: "550e8400-e29b-41d4-a716-446655440000" },
    });
    fireEvent.change(screen.getByLabelText(/appraisal period/i), { target: { value: "2025-26" } });
    fireEvent.change(screen.getByLabelText(/reporting officer id/i), {
      target: { value: "550e8400-e29b-41d4-a716-446655440001" },
    });
    fireEvent.change(screen.getByLabelText(/reviewing officer id/i), {
      target: { value: "550e8400-e29b-41d4-a716-446655440002" },
    });
    fireEvent.change(screen.getByLabelText(/accepting authority id/i), {
      target: { value: "550e8400-e29b-41d4-a716-446655440003" },
    });
    fireEvent.click(screen.getByRole("button", { name: /initiate apar/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, when initiation fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    render(<AparNewPage />);
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
    render(<AparNewPage />);
    fillAndSubmit();

    expect(await screen.findByText("Employee not found.")).toBeInTheDocument();
  });
});
