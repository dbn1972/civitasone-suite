/**
 * GAP-TENANT-HOME-01 / GAP-TENANT-PLANS-04 (+ pinning for CODE-LISTS-04,
 * ORG-HIERARCHY-04, DATA-MIGRATION-04, CONSENT-EXCHANGE-02 server side):
 * the tenant governance READ endpoints the /tenant web area fans out to must
 * authorise by a tenant-admin/config role, not merely a signed-in session.
 *
 * These tests FAIL on the pre-fix code for /v1/tenant/usage, /v1/settings and
 * /v1/plans (which only called resolveContext) and PIN the existing gate on
 * the endpoints that already enforced a role.
 *
 * Pattern mirrors tests/routes-rbac-deep.test.ts (signToken + app.inject).
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aa440002-4444-4000-8000-000000a40002";
const ACTOR = "aa44aaaa-4444-4000-8000-000000a4000b";

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-gov" }, SECRET, 3600);
}
const bearer = (roles: string[]) => ({ authorization: `Bearer ${token(roles)}` });

// A plain signed-in employee with no tenant-admin/config role.
const EMPLOYEE = ["employee"];

afterAll(async () => {
  await sqlClient.end();
});

/**
 * Governance READ endpoints that must be gated. For each: no token -> 401,
 * employee -> 403, an authorised role -> NOT 401/403 (200, or a non-authz
 * status like 404/empty, which still proves the gate let the admin through).
 * `pass` is the least-privileged role that endpoint's gate admits
 * (data-migration is platform/super-admin only; the rest admit tenant_admin).
 */
const GOVERNANCE_READS: Array<{ name: string; url: string; pass: string[] }> = [
  { name: "GET /v1/tenant/usage (quotas dashboard)", url: "/v1/tenant/usage", pass: ["tenant_admin"] },
  { name: "GET /v1/settings (tenant config registry)", url: "/v1/settings", pass: ["tenant_admin"] },
  { name: "GET /v1/plans (plan catalogue + entitlements)", url: "/v1/plans", pass: ["tenant_admin"] },
  // Already-gated endpoints — pinned here so a future regression is caught.
  { name: "GET /v1/code-lists", url: "/v1/code-lists", pass: ["tenant_admin"] },
  { name: "GET /v1/org/hierarchy", url: "/v1/org/hierarchy", pass: ["tenant_admin"] },
  { name: "GET /v1/org/migrations", url: "/v1/org/migrations", pass: ["super_admin"] },
  { name: "GET /v1/consent/requests", url: "/v1/consent/requests", pass: ["tenant_admin"] },
];

describe("tenant governance reads require a tenant-admin/config role", () => {
  for (const ep of GOVERNANCE_READS) {
    describe(ep.name, () => {
      it("401 without a token", async () => {
        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: ep.url });
        await app.close();
        expect(res.statusCode).toBe(401);
      });

      it("403 for a plain employee", async () => {
        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: ep.url, headers: bearer(EMPLOYEE) });
        await app.close();
        expect(res.statusCode).toBe(403);
      });

      it("allows an authorised admin through the gate (not 401/403)", async () => {
        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: ep.url, headers: bearer(ep.pass) });
        await app.close();
        expect([401, 403]).not.toContain(res.statusCode);
      });
    });
  }
});
