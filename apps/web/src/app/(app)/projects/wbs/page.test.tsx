import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("./WbsTree", () => ({
  WbsTree: ({ nodes }: { nodes: unknown[] }) => <div>wbs-tree:{nodes.length}</div>,
}));

import WbsPage from "./page";

const MOCK_NODES = [{ id: "n1", name: "Foundation work", status: "completed", parentId: null }];

function mockWbs(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/projects/wbs")) {
      return Promise.resolve(result);
    }
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("WbsPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders the WBS tree and real stat counts on success", async () => {
    mockWbs({ data: MOCK_NODES, source: "api" });
    render(await WbsPage());
    expect(screen.getByText("wbs-tree:1")).toBeInTheDocument();
    expect(screen.getByText("Total Activities").parentElement).toHaveTextContent("1");
  });

  it("shows the honest empty state when a tenant genuinely has zero WBS items (source: api, [])", async () => {
    mockWbs({ data: [], source: "api" });
    render(await WbsPage());
    expect(screen.getByText("No WBS items")).toBeInTheDocument();
    expect(screen.getByText("Total Activities").parentElement).toHaveTextContent("0");
  });

  it("shows the error state — not the empty-state prompt — on a real fetch failure (source: error)", async () => {
    mockWbs({ data: [], source: "error" });
    render(await WbsPage());
    expect(screen.getByText("We couldn't load this work breakdown structure.")).toBeInTheDocument();
    expect(screen.queryByText("No WBS items")).not.toBeInTheDocument();
    expect(screen.queryByText(/wbs-tree/)).not.toBeInTheDocument();
    expect(screen.getByText("Total Activities").parentElement).toHaveTextContent("—");
  });
});
