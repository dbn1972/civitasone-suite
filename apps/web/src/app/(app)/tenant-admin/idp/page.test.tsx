import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getIdpProvidersMock = vi.fn();
vi.mock("@/app/_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/loaders")>("@/app/_data/loaders");
  return { ...actual, getIdpProviders: (...a: unknown[]) => getIdpProvidersMock(...a) };
});
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, data: unknown) => ({ data, provenance: "live", offline: false, cachedAt: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import IdpListPage from "./page";

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1", name: "Keycloak", protocol: "OIDC", status: "active",
    usersSynced: 10, lastSync: "2026-09-20T00:00:00Z", endpoint: "https://idp.example",
    ...overrides,
  };
}

describe("IdpListPage — FABRICATED (IDP-01) + DEADROUTE (IDP-02)", () => {
  beforeEach(() => getIdpProvidersMock.mockReset());

  it("shows a real oldest-active lastSync date, not the word 'Recent'", async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago (not stale)
    getIdpProvidersMock.mockResolvedValue({ data: [provider({ lastSync: recent })], source: "api" });
    render(await IdpListPage());
    expect(document.body.textContent).not.toMatch(/Recent/);
    const kpi = screen.getByText("Last Sync", { selector: ".lab" }).closest(".stat");
    expect(kpi).toHaveTextContent(/IST/);
  });

  it("has no circular 'Add Provider' CTA", async () => {
    getIdpProvidersMock.mockResolvedValue({ data: [provider()], source: "api" });
    render(await IdpListPage());
    expect(screen.queryByRole("link", { name: /Add Provider/i })).toBeNull();
  });

  it("flags a stale sync (older than 24h)", async () => {
    getIdpProvidersMock.mockResolvedValue({ data: [provider({ lastSync: "2000-01-01T00:00:00Z" })], source: "api" });
    render(await IdpListPage());
    expect(screen.getByText(/Last Sync \(stale\)/)).toBeTruthy();
  });
});
