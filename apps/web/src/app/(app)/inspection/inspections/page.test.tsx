import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import InspectionsPage from "./page";

// The page now calls getInspectionsPage(), whose loader maps the API envelope
// to { rows, total } via `asListResult`. These tests mock the shared fetchJson
// to return the LoaderResult that loader would produce, so they exercise the
// page's parsing/rendering against the real list shape.
function listResult(rows: unknown[], total: number | null, source = "api") {
  return { data: { rows, total }, source };
}

describe("InspectionsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  // Regression for a confirmed CRITICAL bug: execution.inspections' status
  // column is named `state` in the schema/API response (services/inspection-service/
  // src/modules/execution/schema.ts), but the page used to read `row.status`,
  // a field the API never returns. GAP-INSPECTION-INSPECTIONS-01 also renders
  // the status through <StatusPill>, which humanizes the DB value, so the pill
  // shows "Scheduled" (not the raw "scheduled"); the action button still keys
  // off the raw state.
  it("reads the real `state` field (not `status`) so the status shows and the action button renders", async () => {
    fetchJsonMock.mockResolvedValueOnce(
      listResult([{ id: "11111111-2222-4333-8444-555555555555", state: "scheduled", entityId: "e1" }], 1),
    );

    const ui = await InspectionsPage({ searchParams: {} });
    render(ui);

    // StatusPill humanizes the DB enum for display.
    expect(screen.getAllByText("Scheduled").length).toBeGreaterThan(0);
    // actionForStatus("scheduled") => "Start" (InspectionActions.tsx). Before
    // the fix this button never rendered because status was always "".
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  // GAP-INSPECTION-INSPECTIONS-06: friendly, honest empty copy with a CTA —
  // never the old developer string "No inspections returned from the API."
  it("renders an honest empty state with a CTA when there are no inspections", async () => {
    fetchJsonMock.mockResolvedValueOnce(listResult([], 0));

    const ui = await InspectionsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("No inspections yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to assignments/i })).toBeInTheDocument();
    expect(screen.queryByText(/returned from the API/i)).not.toBeInTheDocument();
  });

  // UX-013: a real fetch failure must show the error state, not the same empty
  // prompt a genuinely empty tenant gets.
  it("shows the error state — not the empty-state prompt — on a real fetch failure (source: error)", async () => {
    fetchJsonMock.mockResolvedValueOnce(listResult([], null, "error"));

    const ui = await InspectionsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("We couldn't load inspections.")).toBeInTheDocument();
    expect(screen.queryByText("No inspections yet")).not.toBeInTheDocument();
  });

  // GAP-INSPECTION-INSPECTIONS-03: an API row missing the non-null `state`
  // column means the schema contract broke; show the error state rather than
  // silently rendering a blank/garbled table.
  it("treats a row missing `state` as an error (schema mismatch), not an empty table", async () => {
    fetchJsonMock.mockResolvedValueOnce(
      listResult([{ id: "11111111-2222-4333-8444-555555555555", entityId: "e1" }], 1),
    );

    const ui = await InspectionsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("We couldn't load inspections.")).toBeInTheDocument();
  });

  // GAP-INSPECTION-INSPECTIONS-05: server-side pagination. The page must
  // forward the requested page to the loader and expose a Next link while more
  // pages exist (total > page*pageSize), and a Previous link off page 1.
  it("forwards ?page=2 to the loader and renders prev/next pagination", async () => {
    fetchJsonMock.mockResolvedValueOnce(
      listResult(
        [{ id: "22222222-2222-4333-8444-555555555555", state: "in_progress", entityId: "e2" }],
        100,
      ),
    );

    const ui = await InspectionsPage({ searchParams: { page: "2" } });
    render(ui);

    // The loader was asked for page 2.
    expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("page=2");

    const pager = screen.getByRole("navigation", { name: "Pagination" });
    const prev = within(pager).getByRole("link", { name: "Previous" });
    const next = within(pager).getByRole("link", { name: "Next" });
    expect(prev).toHaveAttribute("href", "/inspection/inspections?page=1");
    expect(next).toHaveAttribute("href", "/inspection/inspections?page=3");
  });

  it("disables Next on the last page (total reached)", async () => {
    fetchJsonMock.mockResolvedValueOnce(
      listResult([{ id: "33333333-2222-4333-8444-555555555555", state: "completed" }], 1),
    );

    const ui = await InspectionsPage({ searchParams: { page: "1" } });
    render(ui);

    // Only one row, total 1 -> no pager controls needed at all.
    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
  });
});
