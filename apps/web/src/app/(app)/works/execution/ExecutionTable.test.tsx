import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Drive provenance deterministically per cache key so we can test each tab's
// independent error handling without the offline cache machinery.
const provByKey: Record<string, "live" | "error-no-data" | "cached"> = {};
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (key: string, initial: unknown[]) => ({
    data: initial,
    provenance: provByKey[key] ?? "live",
    offline: false,
    cachedAt: null,
    fromCache: false,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ExecutionTable } from "./ExecutionTable";

describe("ExecutionTable (GAP-WORKS-EXECUTION-02 / -04)", () => {
  beforeEach(() => {
    provByKey["works-execution-progress"] = "live";
    provByKey["works-execution-issues"] = "live";
  });

  it("GAP-WORKS-EXECUTION-04: the selected tab is linked to its visible tabpanel", () => {
    render(<ExecutionTable progress={[]} issues={[]} progressSource="api" issuesSource="api" />);
    const progressTab = screen.getByRole("tab", { name: "Progress" });
    expect(progressTab).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    // aria-controls on the tab points at the panel id, and the panel is
    // labelled by the tab — the linkage that was entirely missing before.
    expect(progressTab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", progressTab.id);
  });

  it("GAP-WORKS-EXECUTION-04: ArrowRight moves selection to Issues", () => {
    render(<ExecutionTable progress={[]} issues={[]} progressSource="api" issuesSource="api" />);
    const progressTab = screen.getByRole("tab", { name: "Progress" });
    fireEvent.keyDown(progressTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Issues" })).toHaveAttribute("aria-selected", "true");
  });

  it("GAP-WORKS-EXECUTION-02: a progress error shows a retry state, not an empty 'no data' table", () => {
    provByKey["works-execution-progress"] = "error-no-data";
    render(<ExecutionTable progress={[]} issues={[]} progressSource="error" issuesSource="api" />);
    // RefreshErrorState renders an alert with a Try again action.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("No execution data")).toBeNull();
  });

  it("GAP-WORKS-EXECUTION-02: an issues error does not affect the Progress tab", () => {
    provByKey["works-execution-issues"] = "error-no-data";
    render(<ExecutionTable progress={[]} issues={[]} progressSource="api" issuesSource="error" />);
    // Progress tab (default) still renders its normal empty state, no alert.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("No execution data")).toBeInTheDocument();
  });
});
