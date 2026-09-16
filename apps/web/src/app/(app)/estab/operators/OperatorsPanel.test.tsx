import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

import { OperatorsPanel } from "./OperatorsPanel";

describe("OperatorsPanel — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw response body, when enrolling an operator fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/hrms/employees")) return jsonResponse({ data: [] });
      if (u.includes("/estab/operators") && !u.includes("?")) {
        return new Response("employee_id foreign key violation", { status: 422 });
      }
      return jsonResponse({ data: [] }); // initial operators load
    });

    render(<OperatorsPanel />);

    await waitFor(() => expect(screen.getByPlaceholderText("employee UUID")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("employee UUID"), {
      target: { value: "123e4567-e89b-12d3-a456-426614174000" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. Administration"), { target: { value: "Estt" } });
    fireEvent.click(screen.getByRole("button", { name: "Enrol operator" }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/foreign key violation/i);
    expect(document.body.textContent).not.toMatch(/\b422\b/);
  });

  it("propagates a clerk-safe message when toggling an operator's active state fails", async () => {
    const operator = {
      id: "op-1", employeeId: "123e4567-e89b-12d3-a456-426614174000", division: "Estt",
      section: null, deskRole: "dealing_hand", canInitiate: true, active: true,
      updatedAt: "2026-09-01T00:00:00Z",
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/hrms/employees")) return jsonResponse({ data: [] });
      if (u.includes("/estab/operators/op-1")) return new Response("", { status: 500 });
      return jsonResponse({ data: [operator] });
    });

    render(<OperatorsPanel />);

    const toggleBtn = await screen.findByRole("button", { name: "Deactivate" });
    fireEvent.click(toggleBtn);
    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Deactivate");
    fireEvent.click(confirmBtn!);

    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/\b500\b/);
  });
});
