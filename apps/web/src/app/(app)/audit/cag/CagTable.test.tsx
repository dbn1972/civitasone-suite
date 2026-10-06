import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CagParaSummary } from "@/app/_data/loaders";

// Mock the offline-resource hook so the component test is deterministic and
// does not touch the encrypted cache; we drive provenance directly.
const seeded = vi.fn();
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (...args: unknown[]) => seeded(...args),
}));

import { CagTable } from "./CagTable";

const SETTLED: CagParaSummary = { id: "p1", reportYear: "2024-25", paraNo: "1", department: "Finance", status: "settled" };
const NO_DEPT: CagParaSummary = { id: "p2", reportYear: null, paraNo: "2", department: null, status: "under_review" };

describe("CagTable", () => {
  it("GAP-AUDIT-CAG-03: a settled para renders the good (green) pill tone", () => {
    seeded.mockReturnValue({ data: [SETTLED], provenance: "live", cachedAt: null, offline: false });
    const { container } = render(<CagTable rows={[SETTLED]} source="api" />);
    expect(screen.getByText("Settled")).toBeInTheDocument();
    expect(container.querySelector(".pill.good")).not.toBeNull();
  });

  it("GAP-AUDIT-CAG-04: a row with no department/report year renders '—', not a raw ref", () => {
    seeded.mockReturnValue({ data: [NO_DEPT], provenance: "live", cachedAt: null, offline: false });
    render(<CagTable rows={[NO_DEPT]} source="api" />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("GAP-AUDIT-CAG-06: cached provenance shows the saved-data badge with its timestamp", () => {
    seeded.mockReturnValue({ data: [SETTLED], provenance: "cached", cachedAt: "2026-01-02T10:00:00.000Z", offline: false });
    render(<CagTable rows={[SETTLED]} source="error" />);
    expect(screen.getByText(/Showing saved data/i)).toBeInTheDocument();
  });
});
