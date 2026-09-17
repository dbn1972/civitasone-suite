import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrgConfigPage } from "./OrgConfigPage";
import type { OrgHierarchyLevel } from "@/app/_data/loaders";

const LEVELS: OrgHierarchyLevel[] = [
  { id: "ministry", order: 1, label: "Ministry", description: "Top-level governance body", examples: "Ministry of Finance", color: "#1e40af" },
  { id: "department", order: 2, label: "Department", description: "Functional department", examples: "Department of Revenue", color: "#065f46" },
];

// Clicking "Save order" opens the ConfirmDialog, whose own confirm button is
// ALSO labelled "Save order" (confirmLabel="Save order") — both exist in the
// DOM once the dialog is open, the dialog's button rendered after the page's
// trigger button.
function clickSaveOrder() {
  fireEvent.click(screen.getByRole("button", { name: "Save order" }));
  const buttons = screen.getAllByRole("button", { name: "Save order" });
  fireEvent.click(buttons[buttons.length - 1]);
}

describe("OrgConfigPage (COMP-014: real per-tenant org-hierarchy-levels)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Regression test for the bug this page replaced: the old page always
  // rendered the same 5 hardcoded DEFAULT_LEVELS (Ministry/Department/
  // Division/Section/Unit) regardless of anything from the server. This
  // asserts the table renders from the REAL levels passed in as props, not
  // a hardcoded constant — e.g. a tenant with only 2 configured levels sees
  // exactly 2, not the pre-fix hardcoded 5.
  it("renders the real levels passed in from the server loader, not a hardcoded default", () => {
    render(<OrgConfigPage initialLevels={LEVELS} source="api" />);
    // Each level renders twice by design (the editable table row AND the
    // "Reporting chain preview" flow diagram below it) — getAllByText, not
    // getByText.
    expect(screen.getAllByText("Ministry").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Department").length).toBeGreaterThan(0);
    expect(screen.queryByText("Division")).not.toBeInTheDocument();
    expect(screen.queryByText("Section")).not.toBeInTheDocument();
    expect(screen.queryByText("Unit")).not.toBeInTheDocument();
  });

  it("shows an honest empty state on a load failure instead of silently substituting fabricated defaults", () => {
    render(<OrgConfigPage initialLevels={[]} source="error" />);
    // Exact strings, not a shared substring match: the DataSourceBadge
    // ("... — showing nothing") and the table's own empty-state paragraph
    // ("... configuration.") both legitimately contain "Couldn't load the
    // org hierarchy configuration" — asserting on the badge's full, exact
    // text (rather than a substring regex) avoids a false "multiple
    // elements" match between the two.
    expect(screen.getByText("Couldn't load the org hierarchy configuration — showing nothing")).toBeInTheDocument();
    expect(screen.queryByText("Ministry")).not.toBeInTheDocument();
  });

  // The pre-fix persistOrder() sent only {id, order, label} — an edited
  // description/examples/color was silently discarded even when the PUT
  // itself "succeeded". This proves the fix sends (and round-trips) the
  // full shape.
  it("saves the FULL edited level — including description — not just order and label", async () => {
    let sentLevels: Array<{ id: string; description: string }> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (url === "/api/proxy/v1/admin/org-hierarchy-levels" && method === "PUT") {
        sentLevels = JSON.parse((init as RequestInit).body as string).levels;
        return new Response(JSON.stringify({ data: sentLevels }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url} ${method}`);
    });

    render(<OrgConfigPage initialLevels={LEVELS} source="api" />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Updated via test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    clickSaveOrder();

    await waitFor(() => expect(screen.getByText("Org hierarchy saved.")).toBeInTheDocument());
    expect(sentLevels).not.toBeNull();
    const ministry = sentLevels!.find((l) => l.id === "ministry");
    expect(ministry?.description).toBe("Updated via test");
  });

  // The core silent-failure fix: persistOrder()'s old `.catch(() => null)`
  // only ever caught a NETWORK-level fetch() rejection, never a resolved
  // non-2xx response — so the unconditional `setNotice("Org hierarchy
  // saved.")` ran even when the save had actually failed. Sabotage check
  // for that exact bug: a failing PUT must surface a real, visible error
  // and must NEVER show the success notice.
  //
  // UX-016: this error text used to be the backend's raw `message` field (or
  // a bare `Save failed (HTTP ${status})` fallback) shown verbatim. It must
  // now show only the catalogued, clerk-safe copy — never the raw server
  // text.
  it("shows a clerk-safe error, not the raw server text, and does not claim success when the save request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "validation failed: level ids must be unique" }), { status: 400 }),
    );

    render(<OrgConfigPage initialLevels={LEVELS} source="api" />);
    clickSaveOrder();

    // Found by regex, not by role="alert" — ConfirmDialog renders its OWN
    // (always-present-while-open, initially empty) role="alert" div for its
    // own error slot, which OrgConfigPage never populates; querying by role
    // would resolve against that one instead of the page's own error
    // paragraph.
    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText("validation failed: level ids must be unique")).not.toBeInTheDocument();
    expect(screen.queryByText("Org hierarchy saved.")).not.toBeInTheDocument();
  });

  // UX-016 (beyond the guard's own regex): the catch block used to read the
  // caught exception's own `.message` directly, so a genuine browser-level
  // fetch() rejection leaked a raw, non-catalogued technical string (e.g.
  // "Failed to fetch") instead of the same clerk-safe copy used for a failed
  // HTTP response.
  it("also surfaces a clerk-safe error, not the raw exception text, on a genuine network failure (fetch() rejecting)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    render(<OrgConfigPage initialLevels={LEVELS} source="api" />);
    clickSaveOrder();

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
    expect(screen.queryByText("Org hierarchy saved.")).not.toBeInTheDocument();
  });
});
