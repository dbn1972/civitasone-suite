/**
 * TX-013 regression test — hrms-service HRMS audit trail.
 *
 * src/shared/audit.ts's writeAuditLog() is fire-and-forget (never throws,
 * never delays a response — see app.ts's onResponse hook, which fires it via
 * setImmediate for every mutating 2xx response) and inserted into
 * `audit.hr_action_log` on every HRMS mutating action, but that table never
 * existed in any migration in this repo: every single call silently failed
 * with `relation "audit.hr_action_log" does not exist`, invisible until
 * REL-001 unblocked the `Tests` job. See migrations/0135_audit_hr_action_log.sql
 * for the fix.
 *
 * DoD (per docs/ENTERPRISE-GAP-REPORT-2026-09-07.md, TX-013): "a real HRMS
 * mutation produces a row in audit.hr_action_log" — so this asserts on a real
 * row actually persisting, not just that writeAuditLog() doesn't throw. A test
 * that only checked "no throw" would have passed for the entire time this bug
 * was live (the catch-and-log-error swallows the failure), which is exactly
 * why the DoD calls this out explicitly.
 *
 * Sabotage-checked: with migrations/0135_audit_hr_action_log.sql renamed out
 * of the way (table never created), this test fails — no row appears. See the
 * PR description for the sabotage-check transcript.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHmac, randomUUID } from "node:crypto";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

// Same seeded fixture tenant/department/designation used by
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
    sub: "00000000-0000-0000-0000-000000000099",
    iss: "civitasone-dev",
    tid: TENANT,
    tenantId: TENANT,
    sid: "test-tx013",
    email: "tx013@test.dev",
    name: "TX-013 Test",
    roles,
    iat: now,
    exp: now + 3600,
  });
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

/** Poll audit.hr_action_log for a row this test's own request should have produced. */
async function findAuditRow(opts: { path: string; method: string; statusCode: number; since: string }) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const rows = await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
      SELECT tenant_id, actor_id, method, path, entity_type, entity_id, status_code, created_at
      FROM audit.hr_action_log
      WHERE tenant_id = ${TENANT}
        AND method = ${opts.method}
        AND path = ${opts.path}
        AND status_code = ${opts.statusCode}
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

describe("TX-013 — audit.hr_action_log persistence", () => {
  it("a real HRMS mutation (employee create) produces a row in audit.hr_action_log", async () => {
    const since = new Date().toISOString();
    const employeeNo = `TX013-${randomUUID().slice(0, 8)}`;

    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        employeeNo,
        fullName: "TX-013 Audit Regression",
        departmentId: DEPARTMENT,
        designationId: DESIGNATION,
        dateOfJoining: "2026-01-01",
        basicMinor: 1000000,
      },
    });
    expect(res.statusCode).toBe(202);

    const row = await findAuditRow({
      path: "/v1/hrms/employees",
      method: "POST",
      statusCode: 202,
      since,
    });

    // The literal DoD: a real row must actually exist — not merely that
    // writeAuditLog() didn't throw (it never throws, by design).
    expect(row).not.toBeNull();
    expect(row!.tenant_id).toBe(TENANT);
    expect(row!.method).toBe("POST");
    expect(row!.path).toBe("/v1/hrms/employees");
    expect(row!.status_code).toBe(202);
    expect(row!.entity_type).toBe("employee");
  });
});
