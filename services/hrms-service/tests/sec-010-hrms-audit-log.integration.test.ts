/**
 * SEC-010 follow-up regression test — employee.hrms_audit_log persistence.
 *
 * shared/audit-log.ts's createAuditHook() is registered globally at
 * app.ts's `app.addHook("onResponse", createAuditHook())` and fires
 * auditLog() on every successful (< 400) POST/PATCH/PUT/DELETE across the
 * entire service. Before this fix it called auditLog(db, {...}) directly —
 * a bare, non-transactional insert with no app.tenant_id GUC. Once SEC-010
 * put employee.hrms_audit_log under FORCE ROW LEVEL SECURITY, every one of
 * those inserts started failing WITH CHECK — invisibly, because auditLog()
 * itself catches and only logs the error (by design, so audit failures never
 * block the business operation). Same failure shape as TX-013
 * (audit.hr_action_log), same fix: route the write through
 * runWithTenant()/db.transaction() so wrapWithTenantGuc actually sets the
 * GUC before the insert runs.
 *
 * DoD, mirroring TX-013's own: "a real HRMS mutation produces a row in
 * employee.hrms_audit_log" — asserts a row actually persists, not merely
 * that the hook didn't throw (it never throws, by design, so a "did it
 * throw" test would have passed the entire time this bug was live).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHmac, randomUUID } from "node:crypto";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

// Same seeded fixture tenant/department/designation as
// tests/tx-013-audit-hr-action-log.integration.test.ts and
// tests/hrms.integration.test.ts's "POST /v1/hrms/employees returns 202"
// case — already proven to exist against a fully-migrated DB.
const TENANT = "00000000-0000-0000-0000-000000000001";
const DEPARTMENT = "eeeeeeee-0001-0000-0000-000000000001";
const DESIGNATION = "eeeeeeee-0001-0000-0000-000000000003";

let app: FastifyInstance;
let token: string;

function mintToken(roles: string[] = ["super_admin", "hr_admin"]) {
  const SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";
  const now = Math.floor(Date.now() / 1000);
  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: "00000000-0000-0000-0000-000000000098",
    iss: "civitasone-dev",
    tid: TENANT,
    tenantId: TENANT,
    sid: "test-sec010-audit",
    email: "sec010-audit@test.dev",
    name: "SEC-010 Audit Test",
    roles,
    iat: now,
    exp: now + 3600,
  });
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

/** Poll employee.hrms_audit_log for a row this test's own request should have produced. */
async function findAuditRow(opts: { action: string; resourceType: string; since: string }) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
      SELECT tenant_id, actor_id, action, resource_type, resource_id, created_at
      FROM employee.hrms_audit_log
      WHERE tenant_id = ${TENANT}
        AND action = ${opts.action}
        AND resource_type = ${opts.resourceType}
        AND created_at >= ${opts.since}::timestamptz
      ORDER BY created_at DESC
      LIMIT 1
    `);
    if (rows.length > 0) return rows[0];
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

beforeAll(async () => {
  app = await buildApp();
  token = mintToken();
});

afterAll(async () => {
  await app.close();
});

describe("SEC-010 — employee.hrms_audit_log persistence via createAuditHook", () => {
  it("a real HRMS mutation (employee create) produces a row in employee.hrms_audit_log", async () => {
    const since = new Date().toISOString();
    const employeeNo = `SEC010AUDIT-${randomUUID().slice(0, 8)}`;

    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        // createAuditHook() (unlike the app.ts:147 onResponse hook right
        // above it, which correctly reads req.ctx set by authPlugin from the
        // verified JWT) reads req.headers["x-tenant-id"]/"x-actor-id"
        // directly. The gateway's JWT edge (jwt-edge.ts) sets x-tenant-id
        // from the token's `tid` claim on every forwarded request, but only
        // its API-key path (api-key-auth.ts) also sets x-actor-id — a
        // separate, pre-existing gap independent of this fix (flagged
        // separately, not fixed here). Set both explicitly so this test
        // exercises createAuditHook's actual write path.
        "x-tenant-id": TENANT,
        "x-actor-id": "00000000-0000-0000-0000-000000000098",
      },
      payload: {
        employeeNo,
        fullName: "SEC-010 Audit Regression",
        departmentId: DEPARTMENT,
        designationId: DESIGNATION,
        dateOfJoining: "2026-01-01",
        basicMinor: 1000000,
      },
    });
    expect(res.statusCode).toBe(202);

    // createAuditHook() maps POST -> "create" and derives resourceType from
    // the URL's 3rd segment: /v1/hrms/employees -> "employees".
    const row = await findAuditRow({ action: "create", resourceType: "employees", since });

    // The literal DoD: a real row must actually exist — not merely that
    // the hook didn't throw (it never throws, by design).
    expect(row).not.toBeNull();
    expect(row!.tenant_id).toBe(TENANT);
    expect(row!.action).toBe("create");
    expect(row!.resource_type).toBe("employees");
  }, 10000);
});
