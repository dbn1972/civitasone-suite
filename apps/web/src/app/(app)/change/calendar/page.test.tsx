import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ChangeRequest, ChangeFreeze } from "../_data/types";

const getChangeRequests = vi.fn();
const getChangeFreezes = vi.fn();
vi.mock("../_data/loaders", () => ({
  getChangeRequests: () => getChangeRequests(),
  getChangeFreezes: () => getChangeFreezes(),
}));

import Page from "./page";

function scheduled(id: string, start: string, end: string): ChangeRequest {
  return {
    id, title: `Window ${id}`, type: "normal", risk: "low", affectedServices: [],
    description: "", rollbackPlan: null, status: "scheduled", requestedBy: "r", approvedBy: null,
    approvedAt: null, rejectedReason: null, windowStart: start, windowEnd: end,
    releaseNotes: null, pirOutcome: null, pirNotes: null, pirAt: null, createdAt: "", updatedAt: "",
  };
}
function freeze(id: string, startsAt: string, endsAt: string, name = `Freeze ${id}`): ChangeFreeze {
  return { id, name, startsAt, endsAt, reason: "close" };
}

describe("change/calendar page (GAP-CHANGE-CALENDAR-02 / -03 / -01)", () => {
  beforeEach(() => { getChangeRequests.mockReset(); getChangeFreezes.mockReset(); });

  it("CALENDAR-02: a freezes-loader error shows '—' for the Change freezes stat, not 0", async () => {
    getChangeRequests.mockResolvedValue({ data: [], source: "api" });
    getChangeFreezes.mockResolvedValue({ data: [], source: "error" });
    render(await Page({ searchParams: {} }));
    // The 'Change freezes' stat must not read as a reassuring 0.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("CALENDAR-03: ended freezes are hidden by default and surfaced via a toggle", async () => {
    const past = freeze("f-old", "2000-01-01T00:00:00.000Z", "2000-01-02T00:00:00.000Z", "Old freeze");
    const future = freeze("f-new", "2999-01-01T00:00:00.000Z", "2999-01-02T00:00:00.000Z", "Future freeze");
    getChangeRequests.mockResolvedValue({ data: [], source: "api" });
    getChangeFreezes.mockResolvedValue({ data: [past, future], source: "api" });
    render(await Page({ searchParams: {} }));
    expect(screen.getByText("Future freeze")).toBeInTheDocument();
    expect(screen.queryByText("Old freeze")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Show ended \(1\)/ })).toBeInTheDocument();
  });

  it("CALENDAR-01: a window overlapping a freeze is visibly flagged as a conflict", async () => {
    getChangeRequests.mockResolvedValue({
      data: [scheduled("c1", "2026-09-05T02:00:00.000Z", "2026-09-05T04:00:00.000Z")], source: "api",
    });
    getChangeFreezes.mockResolvedValue({
      data: [freeze("f1", "2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z", "YE freeze")], source: "api",
    });
    render(await Page({ searchParams: {} }));
    expect(screen.getByText(/Conflicts with freeze/)).toBeInTheDocument();
  });
});
