/**
 * GAP-CRM display: internal verification / UAT-provisioning roles must never appear in
 * the escalation / task-escalation recipient role pickers (both served by
 * listDirectoryRoles). policy-service's roles table has no system/assignable flag, so the
 * exclusion is keyed on the naming conventions those artefacts are created under -- NOT a
 * hard-coded list of the specific test ids found in the pilot tenant.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isInternalRoleName, listDirectoryRoles, clearDirectoryCache } from "../src/shared/user-directory.js";

const TENANT = "11111111-2222-4333-8444-555555555555";
const fetchMock = vi.fn();
const savedSecret = process.env.INTERNAL_SERVICE_SECRET;
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
beforeEach(() => {
  clearDirectoryCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.INTERNAL_SERVICE_SECRET = globalThis.crypto.randomUUID();
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (savedSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
  else process.env.INTERNAL_SERVICE_SECRET = savedSecret;
});

describe("isInternalRoleName", () => {
  it("flags UAT / verification provisioning roles by name", () => {
    for (const n of [
      "UATTEST-g5-identity-policy-role-1",
      "uattest-anything",
      "deep_verify_test_role",
      "foo_test_role",
      "test_role",
      "qa-test-bucket",
    ])
      expect(isInternalRoleName(n)).toBe(true);
  });

  it("flags by description marker even when the name looks ordinary", () => {
    expect(isInternalRoleName("policy_probe_1", "temp role for policy-service deep verify")).toBe(true);
    expect(isInternalRoleName("probe2", "deep verify helper")).toBe(true);
  });

  it("does NOT flag genuine tenant / catalogue roles", () => {
    for (const n of [
      "crm_admin",
      "crm_user",
      "super_admin",
      "tenant_admin",
      "auditor",
      "officer",
      "dept_head",
      "manager",
      "hr_admin",
      "trade_licence_module_admin",
      "attestation_officer", // contains "test" but not as a token -> kept
      "contest_manager", // ditto
    ])
      expect(isInternalRoleName(n, "standard municipal role")).toBe(false);
  });

  it("ignores non-string input", () => {
    expect(isInternalRoleName(null)).toBe(false);
    expect(isInternalRoleName(123)).toBe(false);
    expect(isInternalRoleName(undefined, undefined)).toBe(false);
  });
});

describe("listDirectoryRoles excludes internal test roles", () => {
  it("drops UATTEST-* and *_test_role while keeping real roles, still sorted by label", async () => {
    fetchMock.mockResolvedValue(json([
      { id: "r1", name: "crm_admin", status: "active" },
      { id: "r2", name: "tenant_admin", status: "active" },
      { id: "r3", name: "UATTEST-g5-identity-policy-role-1", status: "active", description: "UATTEST-g5 role" },
      { id: "r4", name: "deep_verify_test_role", status: "active", description: "temp role for policy-service deep verify" },
      { id: "r5", name: "trade_licence_module_admin", status: "active" },
    ]));
    expect(await listDirectoryRoles(TENANT)).toEqual([
      { key: "crm_admin", label: "crm_admin" },
      { key: "tenant_admin", label: "tenant_admin" },
      { key: "trade_licence_module_admin", label: "trade_licence_module_admin" },
    ]);
  });
});
