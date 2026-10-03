import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const keys: string[] = [];
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (key: string, seed: unknown) => { keys.push(key); return { data: seed, provenance: "live", offline: false, cachedAt: null }; },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { TenantModulesTable } from "./TenantModulesTable";

const mods = [
  { module: "HRMS", enabled: "Yes", users: null, lastActivity: "—", usage: "High" },
  { module: "Finance", enabled: "Yes", users: 7, lastActivity: "—", usage: "Low" },
];

describe("TenantModulesTable (GAP-ADMIN-TENANTS-DETAIL-04/06)", () => {
  it("scopes the cache key per tenant", () => {
    keys.length = 0;
    render(<TenantModulesTable tenantId="tenant-A" modules={mods} />);
    render(<TenantModulesTable tenantId="tenant-B" modules={mods} />);
    expect(new Set(keys)).toEqual(new Set(["admin.tenant.modules:tenant-A", "admin.tenant.modules:tenant-B"]));
  });
  it("shows a dash (not 0) for a missing user count and distinct usage pills", () => {
    render(<TenantModulesTable tenantId="t" modules={mods} />);
    expect(screen.getByText("High").className).toContain("good");
    expect(screen.getByText("Low").className).toContain("mut");
    expect(screen.getByText("Seats in use")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
