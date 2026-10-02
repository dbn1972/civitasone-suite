import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";

const mockedHook = vi.mocked(useSeededResource);
function seed(data: unknown) {
  mockedHook.mockReturnValue({ data: data as never, fromCache: false, offline: false, cachedAt: null, provenance: "live" } as never);
}
import { TDSReturnsTable } from "./TDSReturnsTable";

const ROW = {
  id: "1", vendor_id: "v", vendor_name: "Vendor A", pan: "ABCDE****F", section: "194C", quarter: "Q2", fy: "2025-26",
  tds_amount_minor: "10000", deduction_date: "2026-09-26", status: "filed", created_at: "2026-09-26T00:00:00Z",
};

describe("TDSReturnsTable", () => {
  beforeEach(() => mockedHook.mockReset());

  it("formats the deduction date and shows a dash for a null date (TDS-RETURNS-03)", () => {
    seed([ROW, { ...ROW, id: "2", deduction_date: null }]);
    const { container } = render(<TDSReturnsTable returns={[]} source="api" />);
    expect(container.textContent).toMatch(/26 Sep 2026/);
    expect(container.textContent).not.toContain("2026-09-26");
    expect(container.textContent).toContain("—");
  });

  it("renders filed as a success pill (TDS-RETURNS-06) and shows only the masked PAN (TDS-RETURNS-05)", () => {
    seed([ROW]);
    const { container } = render(<TDSReturnsTable returns={[]} source="api" />);
    const pill = Array.from(container.querySelectorAll(".pill")).find((p) => p.textContent === "Filed");
    expect(pill?.className).toBe("pill good");
    expect(container.textContent).toContain("ABCDE****F");
  });
});
