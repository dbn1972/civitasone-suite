import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { DfaPanel } from "./DfaPanel";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("DfaPanel — step-change announcement (Req 2.6)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("announces the new step title (visually hidden, aria-live assertive) after submitting a draft", async () => {
    const dfa = {
      id: "dfa-1", dfaNo: "DFA-001", communicationType: "letter", subject: "Test",
      status: "draft", editable: true, recipientName: null, updatedAt: "2026-08-17T00:00:00Z",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [dfa] })) // initial load
      .mockResolvedValueOnce(jsonResponse({})) // submit action
      .mockResolvedValueOnce(jsonResponse({ data: [{ ...dfa, status: "pending_approval" }] })); // reload after submit

    render(<DfaPanel />);

    const submitBtn = await screen.findByRole("button", { name: "Submit" });
    fireEvent.click(submitBtn);

    // The ConfirmDialog's own confirm button also reads "Submit" — find it within the dialog.
    const dialog = await screen.findByRole("alertdialog");
    const dialogConfirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Submit");
    expect(dialogConfirm).toBeTruthy();
    fireEvent.click(dialogConfirm!);

    await waitFor(() => {
      const live = document.querySelector('[aria-live="assertive"][aria-atomic="true"]');
      expect(live?.textContent).toBe("Pending approval");
    });
  });
});

describe("DfaPanel — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw HTTP status or backend text, when creating a draft fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] })) // initial load
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "dfa_seq exhausted for section" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      ); // create failure

    render(<DfaPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "+ New draft" }));
    fireEvent.change(screen.getByLabelText(/Subject/i), { target: { value: "Test outgoing letter" } });
    fireEvent.change(screen.getByLabelText(/Draft body/i), { target: { value: "Body text of the letter." } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => {
      const alerts = screen.getAllByText(/couldn't save/i);
      expect(alerts.length).toBeGreaterThan(0);
    });
    expect(document.body.textContent).not.toMatch(/dfa_seq exhausted/i);
    expect(document.body.textContent).not.toMatch(/\b500\b/);
  });

  it("propagates a clerk-safe message (prefixed with the action) when a lifecycle action fails", async () => {
    const dfa = {
      id: "dfa-2", dfaNo: "DFA-002", communicationType: "letter", subject: "Test 2",
      status: "draft", editable: true, recipientName: null, updatedAt: "2026-08-17T00:00:00Z",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [dfa] })) // initial load
      .mockResolvedValueOnce(new Response("", { status: 503 })); // submit action fails

    render(<DfaPanel />);

    const submitBtn = await screen.findByRole("button", { name: "Submit" });
    fireEvent.click(submitBtn);
    const dialog = await screen.findByRole("alertdialog");
    const dialogConfirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Submit");
    fireEvent.click(dialogConfirm!);

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/\b503\b/);
  });
});
