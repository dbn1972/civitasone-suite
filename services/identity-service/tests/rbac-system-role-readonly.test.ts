/**
 * GAP-ADMIN-ROLES-05: a system role's permission set is read-only for anyone
 * without platform authority, enforced in the command layer (not just the UI).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const publish = vi.fn(async () => undefined);
const findRoleById = vi.fn();
const findPermissionById = vi.fn();
const effectiveAccess = vi.fn();

vi.mock("../src/shared/db.js", () => ({ scopedRead: async (fn: (tx: unknown) => unknown) => fn({}) }));
vi.mock("../src/shared/infra.js", () => ({ queue: { publish: (...a: unknown[]) => publish(...(a as [])) } }));
vi.mock("../src/modules/rbac/repo.js", () => ({
  findRoleById: (...a: unknown[]) => findRoleById(...a),
  findPermissionById: (...a: unknown[]) => findPermissionById(...a),
  effectiveAccess: (...a: unknown[]) => effectiveAccess(...a),
}));

import { grantPermission, revokePermission } from "../src/modules/rbac/commands.js";
import { HttpError } from "../src/shared/context.js";

const ctxFor = (roles: string[]) => ({ tenantId: "t1", actorId: "a1", correlationId: "c1", roles }) as never;
const SYSTEM = { id: "r1", key: "super_admin", isSystem: true };
const PLAIN = { id: "r2", key: "auditor", isSystem: false };

beforeEach(() => {
  publish.mockClear();
  findPermissionById.mockResolvedValue({ id: "p1", key: "finance.read" });
  effectiveAccess.mockResolvedValue({ permissions: ["finance.read"] });
});

async function code(p: Promise<unknown>) {
  try { await p; return "ok"; } catch (e) { return e instanceof HttpError ? `${e.status}:${e.code}` : String(e); }
}

describe("system roles are read-only below platform authority", () => {
  it("tenant_admin cannot grant to a system role (403 SYSTEM_ROLE_READONLY), nothing queued", async () => {
    findRoleById.mockResolvedValue(SYSTEM);
    expect(await code(grantPermission(ctxFor(["tenant_admin"]), "r1", "p1"))).toBe("403:SYSTEM_ROLE_READONLY");
    expect(publish).not.toHaveBeenCalled();
  });
  it("tenant_admin cannot revoke from a system role", async () => {
    findRoleById.mockResolvedValue(SYSTEM);
    expect(await code(revokePermission(ctxFor(["tenant_admin"]), "r1", "p1"))).toBe("403:SYSTEM_ROLE_READONLY");
    expect(publish).not.toHaveBeenCalled();
  });
  it("platform authority still can", async () => {
    findRoleById.mockResolvedValue(SYSTEM);
    expect(await code(grantPermission(ctxFor(["platform_admin"]), "r1", "p1"))).toBe("ok");
    expect(await code(revokePermission(ctxFor(["super_admin"]), "r1", "p1"))).toBe("ok");
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it("ordinary roles are unaffected for tenant_admin", async () => {
    findRoleById.mockResolvedValue(PLAIN);
    expect(await code(grantPermission(ctxFor(["tenant_admin"]), "r2", "p1"))).toBe("ok");
    expect(await code(revokePermission(ctxFor(["tenant_admin"]), "r2", "p1"))).toBe("ok");
  });
});
