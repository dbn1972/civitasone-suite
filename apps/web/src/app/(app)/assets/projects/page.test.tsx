import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ProjectsAucPage from "./page";
import { mapAucRows } from "./aucMapper";

const UNDER_CONSTRUCTION = {
  id: "11111111-1111-1111-1111-111111111111",
  projectCode: "AUC-001",
  name: "New District Office Wing",
  wbsRef: "WBS-42",
  accumulatedMinor: 1500000,
  status: "under_construction",
  assetId: null,
};

const CAPITALIZED = {
  id: "22222222-2222-2222-2222-222222222222",
  projectCode: "AUC-002",
  name: "Bridge Retrofit",
  wbsRef: null,
  accumulatedMinor: 9000000,
  status: "capitalized",
  assetId: "33333333-3333-3333-3333-333333333333",
};

describe("ProjectsAucPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders AUC projects from the API", async () => {
    fetchJsonMock.mockResolvedValue({ data: [UNDER_CONSTRUCTION, CAPITALIZED], source: "api" });

    const ui = await ProjectsAucPage();
    render(ui);

    expect(screen.getByText("AUC-001")).toBeInTheDocument();
    expect(screen.getByText("AUC-002")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Capitalize project AUC-001" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View capitalized asset for project AUC-002" })).toBeInTheDocument();
  });

  it("renders the guided empty state when no AUC projects are tracked yet", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await ProjectsAucPage();
    render(ui);

    expect(screen.getByText("No AUC projects yet")).toBeInTheDocument();
  });

  it("shows the data-source badge instead of a friendly empty state on error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await ProjectsAucPage();
    render(ui);

    const badges = screen.getAllByText("Couldn't load — showing nothing");
    expect(badges.length).toBeGreaterThan(0);
    expect(screen.queryByText("No AUC projects yet")).not.toBeInTheDocument();
  });

  it("never fabricates stat counts on error — shows placeholders, not zeros or stale numbers", async () => {
    // Even if a fallback payload happens to carry rows, source:"error" must win —
    // the StatGrid must not render a count/money value as fact.
    fetchJsonMock.mockResolvedValue({ data: [UNDER_CONSTRUCTION, CAPITALIZED], source: "error" });

    const ui = await ProjectsAucPage();
    render(ui);

    const placeholders = screen.getAllByText("—");
    expect(placeholders.length).toBeGreaterThanOrEqual(4);
  });
});

describe("mapAucRows — malformed-payload guard", () => {
  it("drops a row whose accumulatedMinor is a non-integer decimal string instead of crashing", () => {
    const rows = mapAucRows({
      data: [
        { id: "1", projectCode: "AUC-BAD", name: "Bad Row", status: "under_construction", accumulatedMinor: "150.00" },
        { id: "2", projectCode: "AUC-OK", name: "Good Row", status: "under_construction", accumulatedMinor: "150000" },
      ],
    });
    expect(rows).not.toBeNull();
    expect(rows?.map((r) => r.projectCode)).toEqual(["AUC-OK"]);
  });

  it("drops a row whose accumulatedMinor is a non-numeric string instead of crashing", () => {
    const rows = mapAucRows({
      data: [{ id: "1", projectCode: "AUC-BAD", name: "Bad Row", status: "under_construction", accumulatedMinor: "abc" }],
    });
    expect(rows).toEqual([]);
  });

  it("accepts a plain integer number", () => {
    const rows = mapAucRows({
      data: [{ id: "1", projectCode: "AUC-OK", name: "Good Row", status: "under_construction", accumulatedMinor: 150000 }],
    });
    expect(rows?.[0]?.accumulatedMinor).toBe("150000");
  });
});
