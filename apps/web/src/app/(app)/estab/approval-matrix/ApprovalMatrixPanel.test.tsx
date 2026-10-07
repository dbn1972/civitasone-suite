import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

    await waitFor(() => expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument());
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

describe("ApprovalMatrixPanel — load failure (GAP-ESTAB-APPROVAL-MATRIX-01)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows a retryable error (not the empty-matrix text) and disables Add on a 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    render(<ApprovalMatrixPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument());
    expect(screen.queryByText(/No approval rules yet/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add rule" })).toBeDisabled();
  });

  it("shows the empty-matrix message only on a successful empty load", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    render(<ApprovalMatrixPanel />);
    await waitFor(() => expect(screen.getByText(/No approval rules yet/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    // With the required fields filled, Add is enabled (loadFailed is false).
    fireEvent.change(screen.getByPlaceholderText(/PO sanction/i), { target: { value: "Rule" } });
    fireEvent.change(screen.getByPlaceholderText("finance.sanction.director_cto"), { target: { value: "finance.sanction.x" } });
    expect(screen.getByRole("button", { name: "Add rule" })).not.toBeDisabled();
  });
});

describe("ApprovalMatrixPanel — human labels (GAP-ESTAB-APPROVAL-MATRIX-04)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders source-type options with human labels while keeping the raw code as value", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    render(<ApprovalMatrixPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add rule" })).toBeInTheDocument());
    const option = screen.getByRole("option", { name: "Finance: Sanction" }) as HTMLOptionElement;
    expect(option.value).toBe("finance_sanction");
  });

  it("shows a human group heading, not a snake_case code, for existing rules", async () => {
    const rule = {
      id: "r1", module: "finance", sourceType: "finance_sanction", label: "Big sanction",
      minAmountMinor: 0, maxAmountMinor: null, workflowDefinitionCode: "finance.sanction.x",
      startNodeKey: "s", steps: [{ role: "director", label: "Director" }], priority: 100,
      active: true, updatedAt: "2026-09-01T00:00:00Z",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [rule] }));
    render(<ApprovalMatrixPanel />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Finance: Sanction" })).toBeInTheDocument());
  });
});

describe("ApprovalMatrixPanel — money validation (GAP-ESTAB-APPROVAL-MATRIX-05)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("rejects max <= min before any POST", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ data: [] }));
    render(<ApprovalMatrixPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add rule" })).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/PO sanction/i), { target: { value: "Bad band" } });
    fireEvent.change(screen.getByPlaceholderText("finance.sanction.director_cto"), { target: { value: "finance.sanction.x" } });
    fireEvent.change(screen.getByPlaceholderText("director, cto, ceo"), { target: { value: "director" } });
    const [minInput, maxInput] = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    fireEvent.change(minInput, { target: { value: "500" } });
    fireEvent.change(maxInput, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    await waitFor(() => expect(screen.getByText(/greater than the minimum/i)).toBeInTheDocument());
    // Only the initial load fetch happened — no POST.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a 3-decimal amount (no float rounding)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ data: [] }));
    render(<ApprovalMatrixPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add rule" })).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/PO sanction/i), { target: { value: "Odd" } });
    fireEvent.change(screen.getByPlaceholderText("finance.sanction.director_cto"), { target: { value: "finance.sanction.x" } });
    fireEvent.change(screen.getByPlaceholderText("director, cto, ceo"), { target: { value: "director" } });
    const [minInput] = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    fireEvent.change(minInput, { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    await waitFor(() => expect(screen.getByText(/at most two decimals/i)).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("ApprovalMatrixPanel — async create (GAP-ESTAB-APPROVAL-MATRIX-06)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.useRealTimers());

  it("shows a Pending row immediately and replaces it once the rule appears on a later poll", async () => {
    const created = {
      id: "r-new", module: "finance", sourceType: "finance_sanction", label: "Fresh band",
      minAmountMinor: 0, maxAmountMinor: null, workflowDefinitionCode: "finance.sanction.x",
      startNodeKey: "s", steps: [{ role: "director", label: "Director" }], priority: 100,
      active: true, updatedAt: "2026-09-01T00:00:00Z",
    };
    // load() empty, POST 202, then two polls: still empty, then shows the rule.
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] }))          // initial load
      .mockResolvedValueOnce(jsonResponse({ id: "r-new" }, 202))  // POST
      .mockResolvedValueOnce(jsonResponse({ data: [] }))          // poll 1 (read model lags)
      .mockResolvedValueOnce(jsonResponse({ data: [created] }));  // poll 2 (now present)

    render(<ApprovalMatrixPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add rule" })).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/PO sanction/i), { target: { value: "Fresh band" } });
    fireEvent.change(screen.getByPlaceholderText("finance.sanction.director_cto"), { target: { value: "finance.sanction.x" } });
    fireEvent.change(screen.getByPlaceholderText("director, cto, ceo"), { target: { value: "director" } });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    // Flush the POST microtask so the optimistic row is added.
    await vi.waitFor(() => expect(screen.getByText("Fresh band")).toBeInTheDocument());
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);

    // Advance through the bounded polls.
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(1100);
    vi.useRealTimers();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(4));
  });
});
