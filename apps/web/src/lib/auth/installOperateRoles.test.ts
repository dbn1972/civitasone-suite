import { describe, it, expect, vi } from "vitest";
import { hasAnyRole, INSTALL_OPERATE_ROLES, INSTALL_VIEW_ROLES } from "./roleGuard";

vi.mock("next/headers", () => ({ cookies: () => ({ get: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

// install-service returns 403 to install_user on every mutation, so the web
// must not surface operate controls to it.
describe("INSTALL_OPERATE_ROLES", () => {
  it("excludes the read-only install_user", () => {
    expect(INSTALL_OPERATE_ROLES).not.toContain("install_user");
    expect(hasAnyRole(["install_user"], INSTALL_OPERATE_ROLES)).toBe(false);
  });

  it("keeps the install admin roles", () => {
    for (const r of ["install_admin", "super_admin", "tenant_admin"]) {
      expect(hasAnyRole([r], INSTALL_OPERATE_ROLES)).toBe(true);
    }
  });

  it("install_user can still view the install segment", () => {
    expect(hasAnyRole(["install_user"], INSTALL_VIEW_ROLES)).toBe(true);
  });
});
