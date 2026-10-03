import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["super_admin"] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/_data/loaders", () => ({ getSATenants: async () => ({ data: [], source: "api" }) }));

import TenantsPage from "./page";

describe("TenantsPage (GAP-ADMIN-TENANTS-04)", () => {
  it("links to the onboarding queue from the header", async () => {
    render(await TenantsPage());
    const link = screen.getByRole("link", { name: "Onboarding queue" });
    expect(link).toHaveAttribute("href", "/admin/onboarding");
  });
});
