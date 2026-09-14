import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { NewTrainingForm } from "./NewTrainingForm";

/**
 * UX-016: this used to show the raw backend response text (falling back to
 * `Request failed (${res.status})`) verbatim — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("NewTrainingForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function fillAndSubmit() {
    render(<NewTrainingForm />);
    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "Advanced Excel Training" } });
    fireEvent.change(screen.getByLabelText(/from date/i), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText(/to date/i), { target: { value: "2026-10-02" } });
    fireEvent.click(screen.getByRole("button", { name: /create training program/i }));
  }

  it("shows a clerk-safe message, never the raw server text, when creation fails", async () => {
    fetchMock.mockResolvedValue(new Response("hrms-service training-create trace at line 40", { status: 500 }));
    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/hrms-service/);
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});
