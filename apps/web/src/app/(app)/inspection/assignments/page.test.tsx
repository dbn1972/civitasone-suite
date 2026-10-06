import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import AssignmentsPage from "./page";

describe("AssignmentsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  // GAP-INSPECTION-ASSIGNMENTS-04: inspector + scheduled date render from the
  // real assignment fields, and the Scheduled column shows a formatted date.
  it("shows inspector id and the formatted scheduled date", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [
        {
          id: "aaaaaaaa-2222-4333-8444-555555555555",
          inspectionId: "bbbbbbbb-2222-4333-8444-555555555555",
          inspectorId: "cccccccc-2222-4333-8444-555555555555",
          entityId: "dddddddd-2222-4333-8444-555555555555",
          scheduledDate: "2026-03-11",
          status: "assigned",
        },
      ],
      source: "api",
    });

    const ui = await AssignmentsPage();
    render(ui);

    expect(screen.getByText("cccccccc…")).toBeInTheDocument();
    expect(screen.getByText("11 Mar 2026")).toBeInTheDocument();
    expect(screen.getByText("Assigned")).toBeInTheDocument();
    // No row shows "—" for the inspector/scheduled columns when data exists.
    expect(screen.getByRole("columnheader", { name: "Inspector" })).toBeInTheDocument();
  });

  // GAP-INSPECTION-ASSIGNMENTS-06: a failed list hides the create form.
  it("hides the create form when the list failed to load", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await AssignmentsPage();
    render(ui);

    expect(screen.queryByRole("button", { name: /create assignment/i })).not.toBeInTheDocument();
    expect(screen.getByText(/We couldn't load assignments\./)).toBeInTheDocument();
  });

  it("shows the create form when the list loaded (even if empty)", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await AssignmentsPage();
    render(ui);

    expect(screen.getByRole("button", { name: /create assignment/i })).toBeInTheDocument();
  });
});
