import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, d: unknown) => ({ data: d, provenance: "live", offline: false, cachedAt: null }),
}));
vi.mock("../_components/AdminAccessGate", () => ({
  sessionHasAnyRole: () => true,
  AdminAccessDenied: () => null,
}));
vi.mock("./_data", () => ({ getGatewayCatalogue: async () => ({ data: [], source: "api" }) }));

import Page from "./page";

// GAP-ADMIN-GATEWAY-ROUTES-04
describe("gateway-routes page", () => {
  it("uses PageHeader's client-side back link, not a bespoke breadcrumb", async () => {
    render(await Page());
    const back = screen.getByRole("link", { name: "Admin" });
    expect(back).toHaveAttribute("href", "/admin");
    expect(document.querySelector("nav.back")).toBeNull();
  });
});
