import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { useSeededResource } from "@/lib/sync/resource";
import { ModuleListTable } from "./ModuleListTable";

const mockedHook = vi.mocked(useSeededResource);

/**
 * GAP-RECOMMENDATIONS-FEEDBACK-03: ModuleListTable rendered the status column as
 * plain text, so "accepted" and "rejected" looked identical. It now renders a
 * StatusPill. A missing status still shows "—".
 */
describe("ModuleListTable status pill (GAP-RECOMMENDATIONS-FEEDBACK-03)", () => {
  beforeEach(() => {
    mockedHook.mockReturnValue({
      data: [
        { id: "r-1", label: "Rec 1", status: "accepted" },
        { id: "r-2", label: "Rec 2", status: "rejected" },
        { id: "r-3", label: "Rec 3" },
      ],
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "live",
    } as never);
  });

  it("renders accepted as a green pill and rejected as a red pill", () => {
    const { container } = render(<ModuleListTable cacheKey="t" rows={[]} source="api" />);
    const good = container.querySelector(".pill.good");
    const bad = container.querySelector(".pill.bad");
    expect(good).toHaveTextContent(/accepted/i);
    expect(bad).toHaveTextContent(/rejected/i);
  });

  it("shows '—' for a row with no status", () => {
    render(<ModuleListTable cacheKey="t" rows={[]} source="api" />);
    // Rec 3 has no status/sublabel/meta → its status + detail + meta cells are "—".
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });
});
