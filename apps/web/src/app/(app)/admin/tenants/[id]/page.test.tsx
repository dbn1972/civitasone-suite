import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["super_admin"] }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/tenants/t-1",
  useSearchParams: () => new URLSearchParams(),
}));

import TenantDetailPage from "./page";

function detailFails(status: number, errorMessage?: string) {
  fetchJsonMock.mockImplementation((...args: unknown[]) => { const path = String(args[0] ?? "");
    if (path.endsWith("/config")) return Promise.resolve({ data: [], source: "error", status });
    return Promise.resolve({ data: null, source: "error", status, ...(errorMessage ? { errorMessage } : {}) });
  });
}

async function renderPage() {
  render(await TenantDetailPage({ params: Promise.resolve({ id: "t-1" }) }));
}

// GAP-ADMIN-TENANTS-DETAIL-01: only a real 404 may say "Tenant not found".
describe("TenantDetailPage failure states", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("404 -> Tenant not found", async () => {
    detailFails(404);
    await renderPage();
    expect(screen.getByText("Tenant not found")).toBeInTheDocument();
  });

  it("500 -> load error with retry, not 'Tenant not found'", async () => {
    detailFails(500);
    await renderPage();
    expect(screen.queryByText("Tenant not found")).not.toBeInTheDocument();
    expect(screen.queryByText(/may have been removed/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry|refresh/i })).toBeInTheDocument();
  });

  it("403 -> Access restricted", async () => {
    detailFails(403, "requires one of: super_admin, platform_admin");
    await renderPage();
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(screen.queryByText("Tenant not found")).not.toBeInTheDocument();
  });

  it("success renders the tenant", async () => {
    fetchJsonMock.mockImplementation((...args: unknown[]) => { const path = String(args[0] ?? "");
      if (path.endsWith("/config")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: { name: "Acme Board", edition: "PSU", status: "active", region: "ap-south-1" }, source: "api" });
    });
    await renderPage();
    expect(screen.getByText("Tenant: Acme Board")).toBeInTheDocument();
  });
});
