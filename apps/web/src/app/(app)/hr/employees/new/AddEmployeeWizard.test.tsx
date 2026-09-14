import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { AddEmployeeWizard } from "./AddEmployeeWizard";

const DEPARTMENTS = [{ id: "dep1", name: "Finance" }];
const DESIGNATIONS = [{ id: "des1", name: "Section Officer" }];

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Request failed (${res.status})`) verbatim — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("AddEmployeeWizard — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function driveToFinalStepAndSubmit() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddEmployeeWizard departments={DEPARTMENTS} designations={DESIGNATIONS} />
      </NextIntlClientProvider>,
    );

    // Step 1 — Personal Info
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Priya Sharma" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 2 — Employment
    fireEvent.change(await screen.findByLabelText(/employee id/i), { target: { value: "NIC/2026/0001" } });
    fireEvent.change(screen.getByLabelText(/date of joining/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^department/i), { target: { value: "dep1" } });
    fireEvent.change(screen.getByLabelText(/^designation/i), { target: { value: "des1" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 3 — Assignment (no required fields)
    await screen.findByText(/step 3 of/i);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 4 — Statutory (no required fields)
    await screen.findByText(/step 4 of/i);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 5 — Review & submit
    fireEvent.click(await screen.findByRole("button", { name: /create employee record/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, when creation fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await driveToFinalStepAndSubmit();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("never surfaces a raw server error message on a JSON error body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "duplicate employeeNo" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    await driveToFinalStepAndSubmit();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/duplicate employeeNo/);
  });
});
