import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { CreatePensionerForm } from "./CreatePensionerForm";

/**
 * UX-016: this used to show the raw backend response text (falling back to
 * `Request failed (${res.status})`) verbatim — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("CreatePensionerForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function fillAndSubmit() {
    render(<CreatePensionerForm />);
    fireEvent.change(screen.getByLabelText(/ppo number/i), { target: { value: "PPO/2025/001234" } });
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Ramesh Kumar Sharma" } });
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: "1965-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /create pensioner/i }));
  }

  it("shows a clerk-safe message, never the raw server text or status, when creation fails", async () => {
    fetchMock.mockResolvedValue(new Response("payroll-service: pensioner insert trace at line 60", { status: 500 }));
    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/payroll-service/);
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });
});
