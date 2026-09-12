import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import InspectionsPage from "./page";

describe("InspectionsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  // Regression for a confirmed CRITICAL bug: execution.inspections' status
  // column is named `state` in the schema/API response (services/inspection-service/
  // src/modules/execution/schema.ts), but the page used to read `row.status`,
  // a field the API never returns. That made the Status column always show
  // "—" and made InspectionRowAction always receive status="", so
  // actionForStatus("") => null and NO action button ever rendered, for any
  // row, in any real deployment. This test reproduces a real API row shape
  // (state, not status) and would fail against the pre-fix page.tsx.
  it("reads the real `state` field (not `status`) so the status shows and the action button renders", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [{ id: "11111111-2222-4333-8444-555555555555", state: "scheduled", entityId: "e1" }],
      source: "api",
    });

    const ui = await InspectionsPage();
    render(ui);

    expect(screen.getByText("scheduled")).toBeInTheDocument();
    // actionForStatus("scheduled") => "Start" (InspectionActions.tsx). Before
    // the fix this button never rendered because status was always "".
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("renders an honest empty state when there are no inspections", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await InspectionsPage();
    render(ui);

    expect(screen.getByText(/No inspections returned/)).toBeInTheDocument();
  });

  // UX-013: a real fetch failure must show the error state, not the same
  // "No inspections returned" prompt a genuinely empty tenant gets — those
  // used to render pixel-identical because the page checked `data.length
  // === 0` without also looking at `source`.
  it("shows the error state — not the empty-state prompt — on a real fetch failure (source: error)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await InspectionsPage();
    render(ui);

    expect(screen.getByText("We couldn't load this inspections.")).toBeInTheDocument();
    expect(screen.queryByText(/No inspections returned/)).not.toBeInTheDocument();
  });
});
