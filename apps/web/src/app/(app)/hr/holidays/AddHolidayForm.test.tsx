import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddHolidayForm } from "./AddHolidayForm";

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Failed (${res.status})`) verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("AddHolidayForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function openAndFillForm() {
    render(<AddHolidayForm />);
    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));
    fireEvent.change(screen.getByLabelText(/holiday name/i), { target: { value: "Republic Day" } });
    fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: "2027-01-26" } });
    fireEvent.click(screen.getByRole("button", { name: /^add holiday$/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, when creation fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    openAndFillForm();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("never surfaces a raw server error message on a JSON error body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "duplicate holiday date" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    openAndFillForm();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/duplicate holiday date/);
  });
});
