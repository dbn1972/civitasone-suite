import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const resourceMock = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => resourceMock(...a) }));

import { EditionsTable } from "./EditionsTable";

const ed = (name: string, status: string, tenants = 1) => ({ name, modulesIncluded: 3, pricing: "free text", tenants, status });
const statValue = (label: string) => screen.getAllByText(label).find((el) => el.classList.contains("lab"))?.parentElement?.querySelector(".val")?.textContent;

describe("EditionsTable", () => {
  beforeEach(() => resourceMock.mockReset());

  // GAP-ADMIN-EDITIONS-02 + -04
  it("cards follow the cached rows, and a draft is not counted as Deprecated", () => {
    resourceMock.mockReturnValue({
      data: [ed("Std", "active", 4), ed("Draft", "draft", 0), ed("Old", "deprecated", 2)],
      provenance: "cached", offline: false, cachedAt: "2026-09-01T00:00:00Z", fromCache: true,
    });
    render(<EditionsTable editions={[]} source="error" status={500} />);
    expect(statValue("Total Editions")).toBe("3");
    expect(statValue("Active")).toBe("1");
    expect(statValue("Deprecated")).toBe("1");
    expect(statValue("Draft / other")).toBe("1");
    expect(statValue("Total Tenants")).toBe("6");
  });

  // GAP-ADMIN-EDITIONS-03
  it("500 with no cache -> retry UI and dash cards", () => {
    resourceMock.mockReturnValue({ data: [], provenance: "error-no-data", offline: false, cachedAt: null, fromCache: false });
    render(<EditionsTable editions={[]} source="error" status={500} />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(statValue("Total Editions")).toBe("—");
    expect(screen.queryByText("No editions")).not.toBeInTheDocument();
  });

  it("403 -> Access restricted", () => {
    resourceMock.mockReturnValue({ data: [], provenance: "error-no-data", offline: false, cachedAt: null, fromCache: false });
    render(<EditionsTable editions={[]} source="error" status={403} />);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });

  // GAP-ADMIN-EDITIONS-05 (drill-down)
  it("an edition row links to the entitlements console", () => {
    resourceMock.mockReturnValue({ data: [ed("Std", "active")], provenance: "live", offline: false, cachedAt: null, fromCache: false });
    render(<EditionsTable editions={[]} source="api" status={200} />);
    expect(screen.getByRole("link", { name: /Std/ })).toHaveAttribute("href", "/admin/entitlements");
  });
});
