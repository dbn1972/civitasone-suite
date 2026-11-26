/**
 * B22 role catalogue from identity RBAC, B25 division-admin scope, B24 department master.
 * Collaborators (identity, hrms, operator reads) are mocked so no database is needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const T = "11111111-1111-1111-1111-111111111111";
const ADMIN_ACTOR = "22222222-2222-2222-2222-222222222222";
const DIV_ADMIN_EMP = "33333333-3333-3333-3333-333333333333";
const OFFICER_IN = "44444444-4444-4444-4444-444444444444";
const OFFICER_OUT = "55555555-5555-5555-5555-555555555555";

vi.mock("../src/shared/identity-client.js", () => ({ getIdentityRoleKeys: vi.fn() }));
vi.mock("../src/shared/hrms-client.js", () => {
  class HrmsUnavailableError extends Error { readonly code = "HRMS_UNAVAILABLE"; }
  return { resolveActorEmployeeId: vi.fn(), HrmsUnavailableError };
});
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    makeKey: (t: string, r: string, i: string) => `${t}:${r}:${i}`,
    getOrLoad: async <V,>(_k: string, loader: () => Promise<V>) => loader(),
    invalidate: async () => {},
  },
}));
vi.mock("../src/shared/db.js", () => ({ db: {} }));
vi.mock("../src/modules/operators/repo.js", () => ({
  findActiveOperatorsForEmployee: vi.fn(),
  hasActiveOperators: vi.fn(),
  listActiveDivisions: vi.fn(),
}));

import { getIdentityRoleKeys } from "../src/shared/identity-client.js";
import { resolveActorEmployeeId, HrmsUnavailableError } from "../src/shared/hrms-client.js";
import * as opsRepo from "../src/modules/operators/repo.js";
import { loadApproverRoleCatalogue, assertApproverRolesKnownForTenant } from "../src/modules/approval-rules/roleCatalogue.js";
import { assertMayHandOverFrom } from "../src/modules/handover/scope.js";
import { assertDepartmentInMaster } from "../src/modules/operators/eligibility.js";

const desk = (employeeId: string, division: string) => ({ employeeId, division, active: true });
const ctxOf = (roles: string[]) => ({ tenantId: T, actorId: ADMIN_ACTOR, roles, correlationId: "c", actorType: "user", sessionId: "s" }) as never;

const ENV = process.env.ESTAB_APPROVER_ROLES;
beforeEach(() => { vi.clearAllMocks(); delete process.env.ESTAB_APPROVER_ROLES; });
afterEach(() => { if (ENV === undefined) delete process.env.ESTAB_APPROVER_ROLES; else process.env.ESTAB_APPROVER_ROLES = ENV; });

describe("B22 approver roles come from identity RBAC", () => {
  it("unions the tenant's identity role keys with the built-in floor and drops invalid codes", async () => {
    vi.mocked(getIdentityRoleKeys).mockResolvedValue(["estab_section_officer", "finance_approver", "rbac.admin", "System Admin"]);
    const c = await loadApproverRoleCatalogue(T);
    expect(c.source).toBe("identity+default");
    expect(c.roles).toEqual(expect.arrayContaining(["estab_section_officer", "finance_approver", "estab_admin", "estab_deputy_secretary"]));
    expect(c.roles).not.toContain("rbac.admin");
    expect(c.roles).not.toContain("System Admin");
  });
  it("degrades to the built-in list when identity-service cannot answer", async () => {
    vi.mocked(getIdentityRoleKeys).mockResolvedValue(null);
    const c = await loadApproverRoleCatalogue(T);
    expect(c.source).toBe("default");
    expect(c.roles).toContain("estab_admin");
  });
  it("refuses a chain naming a role identity does not know", async () => {
    vi.mocked(getIdentityRoleKeys).mockResolvedValue(["finance_approver"]);
    await expect(assertApproverRolesKnownForTenant(T, [{ role: "ghost_approver" }])).rejects.toMatchObject({ status: 422, code: "UNKNOWN_APPROVER_ROLE" });
    await expect(assertApproverRolesKnownForTenant(T, [{ role: "finance_approver" }])).resolves.toBeUndefined();
  });
});

describe("B25 division admin handover scope", () => {
  it("estab_admin and super_admin are tenant-wide (no lookups)", async () => {
    await expect(assertMayHandOverFrom(ctxOf(["estab_admin"]), OFFICER_OUT)).resolves.toBeUndefined();
    await expect(assertMayHandOverFrom(ctxOf(["estab_division_admin", "super_admin"]), OFFICER_OUT)).resolves.toBeUndefined();
    expect(resolveActorEmployeeId).not.toHaveBeenCalled();
  });
  it("a division admin may take files from an officer in their own division", async () => {
    vi.mocked(resolveActorEmployeeId).mockResolvedValue(DIV_ADMIN_EMP);
    vi.mocked(opsRepo.findActiveOperatorsForEmployee).mockImplementation(async (_t, emp) =>
      (emp === DIV_ADMIN_EMP ? [desk(emp, "Establishment-I")] : emp === OFFICER_IN ? [desk(emp, "Establishment-I")] : []) as never);
    await expect(assertMayHandOverFrom(ctxOf(["estab_division_admin"]), OFFICER_IN)).resolves.toBeUndefined();
  });
  it("a division admin is refused for an officer in another division", async () => {
    vi.mocked(resolveActorEmployeeId).mockResolvedValue(DIV_ADMIN_EMP);
    vi.mocked(opsRepo.findActiveOperatorsForEmployee).mockImplementation(async (_t, emp) =>
      (emp === DIV_ADMIN_EMP ? [desk(emp, "Establishment-I")] : emp === OFFICER_OUT ? [desk(emp, "Accounts")] : []) as never);
    await expect(assertMayHandOverFrom(ctxOf(["estab_division_admin"]), OFFICER_OUT)).rejects.toMatchObject({ status: 403, code: "OUTSIDE_DIVISION_SCOPE" });
  });
  it("a division admin with no desk gets 403", async () => {
    vi.mocked(resolveActorEmployeeId).mockResolvedValue(DIV_ADMIN_EMP);
    vi.mocked(opsRepo.findActiveOperatorsForEmployee).mockResolvedValue([]);
    await expect(assertMayHandOverFrom(ctxOf(["estab_division_admin"]), OFFICER_IN)).rejects.toMatchObject({ status: 403, code: "NO_OPERATOR_DESK" });
  });
  it("a division admin with no linked employee record gets 403", async () => {
    vi.mocked(resolveActorEmployeeId).mockResolvedValue(null);
    await expect(assertMayHandOverFrom(ctxOf(["estab_division_admin"]), OFFICER_IN)).rejects.toMatchObject({ status: 403, code: "NO_OPERATOR_DESK" });
  });
  it("fails closed (503) when HRMS cannot say which division the caller administers", async () => {
    vi.mocked(resolveActorEmployeeId).mockRejectedValue(new HrmsUnavailableError("down"));
    await expect(assertMayHandOverFrom(ctxOf(["estab_division_admin"]), OFFICER_IN)).rejects.toMatchObject({ status: 503 });
  });
});

describe("B24 department master = operator divisions", () => {
  it("a tenant with no operators enrolled stays unrestricted", async () => {
    vi.mocked(opsRepo.hasActiveOperators).mockResolvedValue(false);
    await expect(assertDepartmentInMaster(T, "ANYTHING")).resolves.toBeUndefined();
  });
  it("once operators exist a department outside the divisions is refused", async () => {
    vi.mocked(opsRepo.hasActiveOperators).mockResolvedValue(true);
    vi.mocked(opsRepo.listActiveDivisions).mockResolvedValue(["Establishment-I", "Accounts"]);
    await expect(assertDepartmentInMaster(T, "Establishment-I")).resolves.toBeUndefined();
    await expect(assertDepartmentInMaster(T, "ADMIN")).rejects.toMatchObject({ status: 422, code: "UNKNOWN_DEPARTMENT" });
  });
});
