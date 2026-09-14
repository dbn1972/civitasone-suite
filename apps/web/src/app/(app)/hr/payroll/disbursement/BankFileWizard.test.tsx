import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BankFileWizard } from "./BankFileWizard";

const RUNS = [{ id: "r1", payPeriod: "2026-09", netAmount: 450000 }];

/**
 * UX-016: this used to show the raw backend `error.message`/`error.code`
 * (falling back to `Bank file generation failed (${res.status}).`) verbatim
 * — the same class of leak useFormError closes fleet-wide (UX-003).
 */
describe("BankFileWizard — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw backend error code, when generation fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "PFMS_TIMEOUT", message: "PFMS gateway timeout at retry 3" } }), {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<BankFileWizard runs={RUNS} dscConfig={null} />);

    fireEvent.click(screen.getByRole("button", { name: /next: preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /next: dsc/i }));
    fireEvent.click(screen.getByRole("button", { name: /next: download/i }));
    fireEvent.click(screen.getByRole("button", { name: /download bank file/i }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/PFMS gateway timeout/);
    expect(alert.textContent).not.toMatch(/PFMS_TIMEOUT/);
    expect(alert.textContent).not.toMatch(/\b502\b/);
  });
});
