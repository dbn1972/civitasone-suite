import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { useSeededResource } from "@/lib/sync/resource";
import { ModuleListTable } from "./ModuleListTable";

// Time-ordered UUIDs share their leading 8 chars: the old shortened ID column
// printed the same text for both rows (GAP-TENANT-{CONSENT-EXCHANGE-03, PLANS-02,
// POSITIONS-02, STEWARDSHIP-02, SUBSCRIPTIONS-02}).
const rows = [
  { id: "0198a1b2-0000-7000-8000-000000000001", label: "Storage", status: "OK" },
  { id: "0198a1b2-0000-7000-8000-000000000002", label: "Backup storage", status: "OK" },
];

function mockLive() {
  vi.mocked(useSeededResource).mockReturnValue({
    data: rows,
    fromCache: false,
    offline: false,
    cachedAt: null,
    provenance: "live",
  } as never);
}

describe("ModuleListTable showId (tenant GAP-*-02)", () => {
  it("showId={false}: no ID column and no shortened id text is rendered", () => {
    mockLive();
    const { container } = render(<ModuleListTable cacheKey="t" rows={rows} source="api" showId={false} />);
    expect(screen.queryByText("ID", { selector: "th" })).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("0198a1b2");
    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("Backup storage")).toBeInTheDocument();
  });

  it("default keeps the ID column so every other module is unchanged", () => {
    mockLive();
    render(<ModuleListTable cacheKey="t" rows={rows} source="api" />);
    expect(screen.getByText("ID", { selector: "th" })).toBeInTheDocument();
  });
});
