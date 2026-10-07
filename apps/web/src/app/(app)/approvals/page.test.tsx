import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import MyApprovalsPage from "./page";
import type { MyApprovalItem } from "@/app/_data/loaders";

/** Find the StatCard tile (".stat") whose label is exactly `label`. */
function statTile(label: string): HTMLElement {
  const tiles = Array.from(document.querySelectorAll<HTMLElement>(".stat"));
  const match = tiles.find((t) => t.querySelector(".lab")?.textContent === label);
  if (!match) throw new Error(`no stat tile labelled "${label}"`);
  return match;
}

function statValue(label: string): string {
  return statTile(label).querySelector(".val")?.textContent ?? "";
}

function makeItems(n: number, from = 0): MyApprovalItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${from + i}`,
    taskId: `t${from + i}`,
    instanceName: `Task ${from + i}`,
    refType: "leave_app",
    refId: `r${from + i}`,
    instanceId: `inst-${from + i}`,
    module: "leave",
    status: "pending",
    assignedAt: "2026-09-01T00:00:00Z",
    dueDate: null,
    link: "/hr/leave/approvals",
  }));
}

/** The real getMyApprovals runs; only the HTTP layer (fetchJson) is mocked, so
 * the loader's mapResponse-shaped result is what we hand back here. */
describe("MyApprovalsPage (GAP-APPROVALS-HOME-01 / -03)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("Pending reflects the API total, not the loaded page length; a later page is reachable", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: makeItems(15), total: 40, hasMore: true },
      source: "api",
    });
    render(await MyApprovalsPage({}));

    // Pending stat shows the whole total (40), not the 15 rows loaded.
    expect(statValue("Pending")).toBe("40");

    // The scope notice makes the "first N of M" cap explicit, and a Next link
    // reaches the following page.
    expect(screen.getByText(/Showing 1–15 of 40/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute("href", "/approvals?page=2");
  });

  it("forwards the requested page to the loader as limit/offset and makes page 3 reachable", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: makeItems(10, 30), total: 40, hasMore: false },
      source: "api",
    });
    render(await MyApprovalsPage({ searchParams: { page: "3" } }));

    // page 3, pageSize 15 -> offset 30.
    expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("limit=15&offset=30");
    expect(screen.getByText(/Showing 31–40 of 40/)).toBeInTheDocument();
    // Previous link back to page 2, no Next (last page).
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute("href", "/approvals?page=2");
    expect(screen.queryByRole("link", { name: /Next/ })).not.toBeInTheDocument();
  });

  it("on a failed load every stat shows an em dash, never a misleading 0", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: [], total: null, hasMore: false },
      source: "error",
      status: 500,
    });
    render(await MyApprovalsPage({}));

    for (const label of ["Pending", "Overdue", "Modules", "Due within 7 days"]) {
      expect(statValue(label), `${label} tile`).toBe("—");
    }
    // A real retry (RefreshErrorState), not a 0-count empty table.
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("ignores a junk page param (falls back to page 1 / offset 0)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: makeItems(5), total: 5, hasMore: false },
      source: "api",
    });
    render(await MyApprovalsPage({ searchParams: { page: "-9x" } }));
    expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("offset=0");
  });
});
