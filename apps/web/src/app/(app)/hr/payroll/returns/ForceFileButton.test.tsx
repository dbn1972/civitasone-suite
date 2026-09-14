import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }) }));

import { ForceFileButton } from "./ForceFileButton";

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Force-file failed (${res.status})`) verbatim — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("ForceFileButton — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw HTTP status, when the force-file request fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    render(<ForceFileButton fy="2026-27" quarter="Q2" />);

    fireEvent.click(screen.getByRole("button", { name: /file anyway/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/reason for overriding/i), { target: { value: "Challans pending reconciliation in TRACES" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /file with confirmed override/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/\b500\b/);
  });

  it("never surfaces a raw backend `message` field verbatim", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "TDS_RECONCILIATION_FAILED: variance exceeds threshold" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<ForceFileButton fy="2026-27" quarter="Q2" />);

    fireEvent.click(screen.getByRole("button", { name: /file anyway/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/reason for overriding/i), { target: { value: "Challans pending reconciliation in TRACES" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /file with confirmed override/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/TDS_RECONCILIATION_FAILED/);
  });
});
