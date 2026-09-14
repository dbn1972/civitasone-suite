import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddDesignationForm } from "./AddDesignationForm";

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Failed (${res.status})`) verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("AddDesignationForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function fillAndSubmit() {
    render(<AddDesignationForm onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "CLERK" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Upper Division Clerk" } });
    fireEvent.click(screen.getByRole("button", { name: /add designation/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, when creation fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    fillAndSubmit();

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
          fieldErrors: [{ field: "code", message: "Designation code already exists." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    fillAndSubmit();

    expect(await screen.findByText("Designation code already exists.")).toBeInTheDocument();
  });
});
