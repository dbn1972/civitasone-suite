import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import Page from "./page";

describe("Identity hub — GAP-IDENTITY-HOME-01/02/03/04", () => {
  beforeEach(() => mockGet.mockReset());

  it("HOME-04: description names no internal service", () => {
    sessionWithRoles(["tenant_admin"]);
    render(<Page />);
    expect(screen.queryByText(/identity-service/i)).not.toBeInTheDocument();
    expect(screen.getByText(/for this office/i)).toBeInTheDocument();
  });

  it("HOME-02: a tenant_admin sees the MFA and SSO tiles", () => {
    sessionWithRoles(["tenant_admin"]);
    render(<Page />);
    expect(screen.getByText("MFA policy")).toBeInTheDocument();
    expect(screen.getByText("SSO / IdP")).toBeInTheDocument();
  });

  it("HOME-02: the MFA/SSO tiles are hidden if a non-admin somehow renders the hub", () => {
    // The layout gate already blocks non-admins; this proves the tile-level
    // role filter is wired too (defence-in-depth), by rendering the page body
    // directly with an employee session.
    sessionWithRoles(["employee"]);
    render(<Page />);
    expect(screen.queryByText("MFA policy")).not.toBeInTheDocument();
    expect(screen.queryByText("SSO / IdP")).not.toBeInTheDocument();
    // Non-role-gated tiles still render.
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("WebAuthn")).toBeInTheDocument();
  });

  it("HOME-03: no bare '(admin)' suffix on the MFA/SSO tiles", () => {
    sessionWithRoles(["tenant_admin"]);
    render(<Page />);
    expect(screen.queryByText(/\(admin\)/)).not.toBeInTheDocument();
  });

  it("USERS-02 / API-KEYS-02: Users and API keys tiles point at the canonical tenant-admin routes", () => {
    sessionWithRoles(["tenant_admin"]);
    render(<Page />);
    expect(screen.getByText("Users").closest("a")).toHaveAttribute("href", "/tenant-admin/users");
    expect(screen.getByText("API keys").closest("a")).toHaveAttribute("href", "/tenant-admin/api-keys");
  });

  it("HOME-01: the seven tiles render distinct vector icons (not the all-same 📁 fallback / .notdef box)", () => {
    sessionWithRoles(["tenant_admin"]);
    const { container } = render(<Page />);
    const iconBoxes = Array.from(container.querySelectorAll(".mtile .ic"));
    expect(iconBoxes.length).toBeGreaterThanOrEqual(7);

    // Every tile icon now renders as an inline <svg> (lucide), not raw emoji
    // text — so none is the ".notdef" missing-glyph box and none is the raw
    // 📁 fallback character.
    for (const box of iconBoxes) {
      expect(box.querySelector("svg")).not.toBeNull();
      expect(box.textContent).toBe(""); // no raw emoji text left
    }

    // The icons are distinct: collect each svg's lucide class signature and
    // assert there is more than one kind (the bug was all seven identical).
    const signatures = iconBoxes.map((b) => b.querySelector("svg")?.getAttribute("class") ?? "");
    expect(new Set(signatures).size).toBeGreaterThan(1);
  });
});
