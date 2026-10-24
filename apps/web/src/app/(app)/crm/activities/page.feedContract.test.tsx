/**
 * The /crm/activities screen against the REAL scoped-feed wire shape: the backend envelope goes
 * through the loader's real mapper (not hand-built entries) and the page's derived stats and the
 * table props come out right.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("../../../_data/loaders")>("../../../_data/loaders");
  const T = "aaaaaaaa-2222-4000-8000-0000000fd001";
  const mk = (n: number, over: Record<string, unknown>) => ({
    id: `55555555-cccc-4000-8000-0000000fd0${n}0`, tenantId: T, actorName: "Asha Rao", text: "t", contactId: null, dealId: null,
    accountId: null, type: "call", subject: `Row ${n}`, status: "open", dueDate: null, remindAt: null, location: null,
    completedAt: null, createdAt: "2026-10-24T03:00:00.000Z", ownerId: null, owner: "Asha Rao", relatedType: null, relatedTo: null, ...over,
  });
  const feed = {
    data: [mk(1, { status: "overdue", dueDate: "2020-01-01" }), mk(2, { status: "overdue", dueDate: "2020-01-02" }), mk(3, { status: "completed" }), mk(4, {})],
    pagination: { hasMore: false, pageSize: 200, total: 4 },
  };
  return { ...actual, getCRMActivities: async () => ({ data: actual.mapCRMActivityEntries(feed), source: "api" }) };
});
vi.mock("./ActivitiesTable", () => ({
  ActivitiesTable: ({ activities, source }: { activities: unknown[]; source: string }) => (
    <div data-testid="act-table" data-count={activities.length} data-source={source} />
  ),
}));
vi.mock("./LogActivityButton", () => ({ LogActivityButton: () => <button>Log</button> }));

import Page from "./page";

describe("Activities page on the real feed shape", () => {
  it("renders every feed row (no 400 / empty register) with api source and derived overdue/completed stats", async () => {
    render(await Page({ searchParams: Promise.resolve({}) }));
    const table = screen.getByTestId("act-table");
    expect(table.getAttribute("data-count")).toBe("4");
    expect(table.getAttribute("data-source")).toBe("api");
    expect(screen.getByText("Total Activities").parentElement?.textContent).toContain("4");
    expect(screen.getByText("Overdue").parentElement?.textContent).toContain("2");
    expect(screen.getByText("Completed").parentElement?.textContent).toContain("1");
  });
});
