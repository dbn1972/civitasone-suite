import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { TravelRequestForm } from "./TravelRequestForm";

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Failed (${res.status})`) verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 */
describe("TravelRequestForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function openAndFillForm() {
    render(<TravelRequestForm />);
    fireEvent.click(screen.getByRole("button", { name: /new request/i }));
    fireEvent.change(screen.getByLabelText(/purpose/i), { target: { value: "Field inspection" } });
    fireEvent.change(screen.getByLabelText(/destination/i), { target: { value: "Pune" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-10-03" } });
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, when submission fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    openAndFillForm();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("never surfaces a raw server error message on a JSON error body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "travel-service: budget code invalid" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    openAndFillForm();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/travel-service/);
  });
});
