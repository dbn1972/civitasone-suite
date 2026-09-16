import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

import { ApprovalMatrixPanel } from "./ApprovalMatrixPanel";

describe("ApprovalMatrixPanel — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when adding a rule fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] })) // initial load
      .mockResolvedValueOnce(new Response("workflow_definition_code not found", { status: 422 })); // create fails

    render(<ApprovalMatrixPanel />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Add rule" })).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/PO sanction/i), { target: { value: "Test rule" } });
    fireEvent.change(screen.getByPlaceholderText("finance.sanction.director_cto"), {
      target: { value: "finance.sanction.test" },
    });
    fireEvent.change(screen.getByPlaceholderText("director, cto, ceo"), { target: { value: "director" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/workflow_definition_code not found/i);
    expect(document.body.textContent).not.toMatch(/\b422\b/);
  });

  it("propagates a clerk-safe message when toggling a rule's active state fails", async () => {
    const rule = {
      id: "rule-1", module: "finance", sourceType: "finance_sanction", label: "Test rule",
      minAmountMinor: 0, maxAmountMinor: null, workflowDefinitionCode: "finance.sanction.test",
      startNodeKey: "start", steps: [{ role: "director", label: "Director" }], priority: 100,
      active: true, updatedAt: "2026-09-01T00:00:00Z",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [rule] })) // initial load
      .mockResolvedValueOnce(new Response("", { status: 500 })); // toggle fails

    render(<ApprovalMatrixPanel />);

    const toggleBtn = await screen.findByRole("button", { name: "Deactivate" });
    fireEvent.click(toggleBtn);
    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Deactivate");
    fireEvent.click(confirmBtn!);

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/\b500\b/);
  });
});
