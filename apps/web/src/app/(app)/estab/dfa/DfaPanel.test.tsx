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
