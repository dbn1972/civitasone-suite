import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, data: unknown) => ({ data, provenance: "live", offline: false, cachedAt: null }),
}));

import { IdpTable } from "./IdpTable";

const providers = [
  {
    id: "p1",
    name: "Keycloak",
    protocol: "OIDC",
    status: "active",
    usersSynced: 42,
    lastSync: "2026-09-29T00:00:00Z",
    endpoint: "https://admin:secret@idp.example.gov.in/realms/corp?x=1",
  },
];

describe("IdpTable — PII/I18N (IDP-03) + export audit (IDP-04)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("masks the endpoint to scheme+host (no realm, userinfo, query)", () => {
    render(<IdpTable providers={providers} source="api" />);
    expect(screen.getByText("https://idp.example.gov.in")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/realms\/corp/);
    expect(document.body.textContent).not.toMatch(/secret/);
  });

  it("renders lastSync with an IST label", () => {
    render(<IdpTable providers={providers} source="api" />);
    expect(screen.getByText(/29 Sep 2026.*IST/)).toBeTruthy();
  });

  it("records an export audit beacon when CSV is downloaded", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    // jsdom has no real anchor click download; stub it.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    render(<IdpTable providers={providers} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/proxy/v1/admin/idp/providers/export-audit",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
