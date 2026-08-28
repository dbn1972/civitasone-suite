import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));

import { NewJobOpeningForm } from "./NewJobOpeningForm";

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/reference no/i), { target: { value: "JOB-2026-0001" } });
  fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "Junior Engineer" } });
  fireEvent.change(screen.getByLabelText(/department id/i), {
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
    render(<NewJobOpeningForm />);
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
    render(<NewJobOpeningForm />);
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
    render(<NewJobOpeningForm />);
    fillRequiredFields();
    const btn = screen.getByRole("button", { name: /create job opening/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /submitted/i })).toBeDisabled();
    });
  });

  it("still blocks submit client-side when Reference No is empty", () => {
    render(<NewJobOpeningForm />);
    fireEvent.click(screen.getByRole("button", { name: /create job opening/i }));
    expect(screen.getByText(/reference no is required/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces a real server error instead of a false success", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => "duplicate refNo",
    });
    render(<NewJobOpeningForm />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /create job opening/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/duplicate refNo/i);
    });
  });
});
