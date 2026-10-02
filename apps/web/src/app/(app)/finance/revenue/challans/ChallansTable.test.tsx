import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";

const mockedHook = vi.mocked(useSeededResource);
function seed(data: unknown, provenance: "live" | "cached" | "error-no-data") {
  mockedHook.mockReturnValue({
    data: data as never, fromCache: provenance === "cached", offline: false,
    cachedAt: provenance === "cached" ? "2026-09-01T00:00:00.000Z" : null, provenance,
  } as never);
}
import { ChallansTable } from "./ChallansTable";

describe("ChallansTable (GAP-FINANCE-REVENUE-CHALLANS-01)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("formats the Date column instead of printing the raw ISO timestamp", () => {
    seed([{
      id: "c1", challanNo: "CHN/1", receiptHeadId: "h", depositor: "A", amountMinor: "100", currency: "INR",
      grnNo: null, status: "verified", createdAt: "2026-09-26T09:40:00.000Z", updatedAt: "2026-09-26T09:40:00.000Z", version: 1,
    }], "live");
    const { container } = render(<ChallansTable challans={[]} source="api" />);
    expect(container.textContent).not.toContain("2026-09-26T09:40:00.000Z");
    expect(container.textContent).toMatch(/26 Sep 2026/);
  });
});
