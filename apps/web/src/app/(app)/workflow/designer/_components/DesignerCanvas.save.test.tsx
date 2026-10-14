import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DesignerCanvas } from "./DesignerCanvas";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// GAP-WORKFLOW-DESIGNER-01: unsaved work is guarded and Save is blocked while
// the last validation run found problems.
describe("DesignerCanvas save guard", () => {
  it("is clean on load, dirty after an edit (beforeunload guard), and blocks Save after a failed validation", async () => {
    render(<DesignerCanvas definitions={[]} canAuthor />);

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText("Workflow name"), { target: { value: "Leave approval v2" } });
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);

    // An empty graph has no start/end event, so validation fails and Save is blocked.
    fireEvent.click(screen.getByLabelText("Validate workflow graph"));
    const save = await screen.findByRole("button", { name: /save as draft/i });
    expect(save).toBeDisabled();
  });
});
