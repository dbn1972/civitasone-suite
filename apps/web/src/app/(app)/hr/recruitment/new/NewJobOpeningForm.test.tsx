import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));

import { NewJobOpeningForm } from "./NewJobOpeningForm";

// UX-017: NewJobOpeningForm now reads its copy through next-intl
// (useTranslations("recruitmentNewJob")), so it needs a real provider in the
// tree -- same pattern as hr/leave/apply/ApplyLeaveForm.test.tsx.
function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NewJobOpeningForm />
    </NextIntlClientProvider>,
  );
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/reference no/i), { target: { value: "JOB-2026-0001" } });
  fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "Junior Engineer" } });
  // MEDIUM finding: the raw "Department ID (UUID)" text box is now a
  // friendly "Department" dropdown (falling back to the same raw-UUID input,
  // still matched here, when the departments list hasn't loaded -- exactly
  // the case in these tests, since the shared bare `fetch` mock below never
  // resolves a real department list).
  fireEvent.change(screen.getByLabelText(/department/i), {
    target: { value: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" },
  });
}

describe("NewJobOpeningForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not claim the vacancy was created — the API only accepts (202) a queued command", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => JSON.stringify({ taskId: "t1" }),
    });
    renderForm();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /create job opening/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/submitted/i);
    });
    // The old copy asserted completion the server never confirmed — must be gone.
    expect(screen.queryByText(/created successfully/i)).not.toBeInTheDocument();
  });

  it("stays on the page after success so the confirmation is actually visible, and offers a way back", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => "{}",
    });
    renderForm();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /create job opening/i }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /back to recruitment/i })).toHaveAttribute("href", "/hr/recruitment");
    });
    // The reference number the officer typed is still readable, not silently wiped by a redirect.
    expect(screen.getByDisplayValue("JOB-2026-0001")).toBeInTheDocument();
  });

  it("disables the submit button after success to prevent a duplicate double-submit", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => "{}",
    });
    renderForm();
    fillRequiredFields();
    const btn = screen.getByRole("button", { name: /create job opening/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /submitted/i })).toBeDisabled();
    });
  });

  it("still blocks submit client-side when Reference No is empty", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /create job opening/i }));
    expect(screen.getByText(/reference no is required/i)).toBeInTheDocument();
    // MEDIUM finding: the form now fetches the department list on mount (to
    // populate the new dropdown), so `fetch` itself is no longer called
    // zero times overall -- what must still hold is that the SUBMIT
    // endpoint specifically is never reached when client validation blocks.
    expect(fetch).not.toHaveBeenCalledWith("/api/proxy/v1/hrms/job-openings", expect.anything());
  });

  it("surfaces a real server error instead of a false success", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => "duplicate refNo",
    });
    renderForm();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /create job opening/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn't save/i);
    });
  });

  // UX-016: this used to show the raw server response text ("duplicate
  // refNo", falling back to `Request failed (${res.status})`) verbatim —
  // the same class of leak useFormError closes fleet-wide (UX-003). The
  // test above already covers the happy assertion (clerk-safe message
  // shown); this one is the two-sided check that the raw text is gone.
  it("never surfaces the raw server response text on a failed submission", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => "duplicate refNo",
    });
    renderForm();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /create job opening/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/duplicate refNo/);
    expect(alert.textContent).not.toMatch(/\b409\b/);
  });
});
