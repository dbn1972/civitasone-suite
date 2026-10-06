import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { getSsoProviders } = vi.hoisted(() => ({ getSsoProviders: vi.fn() }));
vi.mock("@/app/_data/loaders", () => ({ getSsoProviders: () => getSsoProviders() }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (_k: string, data: unknown) => ({ data }) }));

import SSOPage from "./page";

afterEach(() => vi.clearAllMocks());

describe("SSOPage (GAP-TENANT-ADMIN-SSO-01/02/03/05)", () => {
  it("has no circular 'Configure IDP' link to /tenant-admin/idp (SSO-01)", async () => {
    getSsoProviders.mockResolvedValue({ source: "api", data: [] });
    const ui = await SSOPage();
    render(ui);
    const idpLinks = screen.queryAllByRole("link").filter((a) => a.getAttribute("href") === "/tenant-admin/idp");
    expect(idpLinks).toHaveLength(0);
    expect(document.body.textContent).toMatch(/provisioned by platform operations/i);
  });

  it("shows the real latest lastSync, not the literal 'Recent' (SSO-02)", async () => {
    getSsoProviders.mockResolvedValue({
      source: "api",
      data: [
        { id: "p1", name: "A", protocol: "OIDC", entityId: "e1", status: "active", lastSync: "2026-09-24T00:00:00Z" },
        { id: "p2", name: "B", protocol: "OIDC", entityId: "e2", status: "active", lastSync: "2026-09-29T00:00:00Z" },
      ],
    });
    const ui = await SSOPage();
    render(ui);
    expect(document.body.textContent).not.toMatch(/Recent/);
    expect(screen.getAllByText(/29 Sep 2026/).length).toBeGreaterThanOrEqual(1);
  });

  it("derives the Protocols tile from configured providers (SSO-05)", async () => {
    getSsoProviders.mockResolvedValue({
      source: "api",
      data: [{ id: "p1", name: "A", protocol: "oidc", entityId: "e1", status: "active", lastSync: "2026-09-29T00:00:00Z" }],
    });
    const ui = await SSOPage();
    render(ui);
    expect(screen.getAllByText("OIDC").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("SAML / OIDC")).not.toBeInTheDocument();
  });

  it("does not use a users icon or compute totalUsers (SSO-03)", async () => {
    getSsoProviders.mockResolvedValue({ source: "api", data: [] });
    const ui = await SSOPage();
    render(ui);
    expect(document.body.textContent).not.toMatch(/👥/);
  });
});
