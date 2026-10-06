import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";
import { WbsTree } from "./WbsTree";
import type { ProjectWbsNode } from "@/app/_data/loaders";

// WbsTree uses useSeededResource, which fires a background fetch on mount.
// Stub it so the test environment doesn't make a real network call; the
// component renders the seeded data synchronously regardless.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))),
  );
});

const NODES: ProjectWbsNode[] = [
  { id: "p1", name: "Phase 1", status: "in_progress", parentId: null, projectId: "proj-123" },
  { id: "a1", name: "Activity 1", status: "completed", parentId: "p1", projectId: "proj-123" },
];

describe("GAP-PROJECTS-WBS-01: WbsTree a11y (no fake tree widget)", () => {
  it("does not announce a tree/treeitem role or aria-selected it cannot honour", () => {
    const { container } = render(<WbsTree nodes={NODES} source="api" />);
    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(container.querySelector('[role="treeitem"]')).toBeNull();
    expect(container.querySelector("[aria-selected]")).toBeNull();
    expect(container.querySelector("[aria-expanded]")).toBeNull();
  });

  it("renders the hierarchy as native nested lists", () => {
    const { container } = render(<WbsTree nodes={NODES} source="api" />);
    // outer list + nested child list
    expect(container.querySelectorAll("ul").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll("li").length).toBe(2);
  });
});

describe("GAP-PROJECTS-WBS-03: node links to its project", () => {
  it("links a node name to /projects/<projectId> when projectId is present", () => {
    render(<WbsTree nodes={NODES} source="api" />);
    const link = screen.getByRole("link", { name: "Phase 1" });
    expect(link).toHaveAttribute("href", "/projects/proj-123");
  });

  it("renders plain text (no link) when a node has no projectId", () => {
    const noPid: ProjectWbsNode[] = [{ id: "x", name: "Orphan", status: "pending", parentId: null }];
    render(<WbsTree nodes={noPid} source="api" />);
    expect(screen.queryByRole("link", { name: "Orphan" })).toBeNull();
    expect(screen.getByText("Orphan")).toBeInTheDocument();
  });
});
