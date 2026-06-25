/**
 * DASHBOARD ACCESS CONTROL — owner / shared / admin / cross-tenant.
 * Pure decision functions, so we can enumerate every case deterministically.
 */
import { describe, it, expect } from "vitest";
import type { RequestContext } from "@civitasone/types";
import { canView, canEdit, canShare } from "../src/modules/dashboards/access.js";
import type { DashboardView, ShareView } from "../src/modules/dashboards/schema.js";

const TENANT = "11111111-aaaa-4000-8000-000000000001";
const OWNER = "22222222-bbbb-4000-8000-000000000002";
const OTHER = "33333333-cccc-4000-8000-000000000003";

function ctx(actorId: string, roles: string[], tenantId = TENANT): RequestContext {
  return { tenantId, actorId, actorType: "user", roles, correlationId: "c1" };
}

function dash(over: Partial<DashboardView> = {}): DashboardView {
  return {
    id: "dddddddd-0000-4000-8000-000000000001",
    tenantId: TENANT,
    name: "Board",
    description: null,
    status: "active",
    ownerId: OWNER,
    visibility: "private",
    layout: {},
    version: 1,
    ...over,
  };
}

describe("canView", () => {
  it("owner can always view", () => {
    expect(canView(ctx(OWNER, ["analytics_user"]), dash())).toBe(true);
  });

  it("a non-owner cannot view a private dashboard", () => {
    expect(canView(ctx(OTHER, ["analytics_user"]), dash())).toBe(false);
  });

  it("a shared user can view a shared dashboard", () => {
    const shares: ShareView[] = [{ id: "s1", dashboardId: dash().id, principalId: OTHER, access: "view" }];
    expect(canView(ctx(OTHER, ["analytics_user"]), dash({ visibility: "shared" }), shares)).toBe(true);
  });

  it("a user with no share cannot view even a shared dashboard", () => {
    expect(canView(ctx(OTHER, ["analytics_user"]), dash({ visibility: "shared" }), [])).toBe(false);
  });

  it("an analytics_admin can view any dashboard in-tenant", () => {
    expect(canView(ctx(OTHER, ["analytics_admin"]), dash())).toBe(true);
  });

  it("NOBODY can view another tenant's dashboard — not even super_admin", () => {
    const crossTenant = ctx(OWNER, ["super_admin"], "99999999-9999-4000-8000-000000000099");
    expect(canView(crossTenant, dash())).toBe(false);
  });
});

describe("canEdit", () => {
  it("owner can edit", () => {
    expect(canEdit(ctx(OWNER, ["analytics_user"]), dash())).toBe(true);
  });

  it("a view-only share cannot edit", () => {
    const shares: ShareView[] = [{ id: "s1", dashboardId: dash().id, principalId: OTHER, access: "view" }];
    expect(canEdit(ctx(OTHER, ["analytics_user"]), dash({ visibility: "shared" }), shares)).toBe(false);
  });

  it("an edit share can edit", () => {
    const shares: ShareView[] = [{ id: "s1", dashboardId: dash().id, principalId: OTHER, access: "edit" }];
    expect(canEdit(ctx(OTHER, ["analytics_user"]), dash({ visibility: "shared" }), shares)).toBe(true);
  });

  it("cross-tenant editor is denied", () => {
    const shares: ShareView[] = [{ id: "s1", dashboardId: dash().id, principalId: OTHER, access: "edit" }];
    const crossTenant = ctx(OTHER, ["analytics_admin"], "99999999-9999-4000-8000-000000000099");
    expect(canEdit(crossTenant, dash({ visibility: "shared" }), shares)).toBe(false);
  });
});

describe("canShare", () => {
  it("only owner or admin may share", () => {
    expect(canShare(ctx(OWNER, ["analytics_user"]), dash())).toBe(true);
    expect(canShare(ctx(OTHER, ["analytics_admin"]), dash())).toBe(true);
    expect(canShare(ctx(OTHER, ["analytics_user"]), dash())).toBe(false);
  });
});
