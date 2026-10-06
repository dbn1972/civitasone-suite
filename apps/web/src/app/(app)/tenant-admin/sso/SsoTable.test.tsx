import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, data: unknown) => ({ data }),
}));

import { SsoTable } from "./SsoTable";

describe("SsoTable — guarded lastSync (GAP-TENANT-ADMIN-SSO-04)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders '—' for a missing/invalid lastSync instead of 'Invalid Date'", () => {
    render(
      <SsoTable
        source="api"
        providers={[
          { id: "p1", name: "Keycloak", protocol: "OIDC", entityId: "urn:kc", status: "active", lastSync: "" },
          { id: "p2", name: "AzureAD", protocol: "SAML", entityId: "urn:az", status: "active", lastSync: "garbage" },
        ]}
      />,
    );
    expect(document.body.textContent).not.toMatch(/Invalid Date/);
    // Empty lastSync renders the "—" placeholder (not "Invalid Date"/1970).
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toMatch(/1970/);
  });

  it("renders a valid lastSync as an IST date-time", () => {
    render(
      <SsoTable
        source="api"
        providers={[{ id: "p3", name: "Okta", protocol: "OIDC", entityId: "urn:okta", status: "active", lastSync: "2026-09-29T00:00:00Z" }]}
      />,
    );
    expect(screen.getByText(/29 Sep 2026/)).toBeInTheDocument();
  });
});
