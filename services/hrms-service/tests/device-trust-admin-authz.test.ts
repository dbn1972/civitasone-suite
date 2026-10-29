/**
 * Regression test for a real, live security gap in device-trust: unlike
 * their sibling admin actions in the same file (block/unblock/policy-update,
 * which all correctly call requireRole(ctx, ["hr_admin", "it_admin",
 * "super_admin"])), GET /v1/hrms/devices/admin and
 * GET /v1/hrms/devices/:deviceId/activity called no authz helper at all.
 * Any authenticated employee of any role could list every device (name,
 * platform, rooted/compliance flags, last IP, plus the linked employee's
 * name/code/department) accessing org data tenant-wide, or pull the full
 * activity/IP history of any device by guessing/enumerating a device id.
 *
 * Fixed by adding requireRole(ctx, ["hr_admin", "it_admin", "super_admin"])
 * to both routes, mirroring the exact role set already used by
 * block/unblock/policy-update in this same file -- no new role set invented.
 *
 * Note on the GET /v1/hrms/devices/admin "allows <role>" tests below: that
 * route has a separate, pre-existing bug unrelated to this authz fix -- its
 * LEFT JOIN compares e.user_id to d.user_id, but employee.hrms_employees has
 * no user_id column (it links via user_ref; see device-trust-rls-real-db
 * .test.ts's identical note, and PostgresError 42703 "column e.user_id does
 * not exist", confirmed live against a real DB). No prior test ever
 * exercised this query with a request that gets past a role gate (there was
 * no gate before this fix), so it was never actually surfaced until now.
 * Fixing the wrong column name is out of scope here, same call
 * device-trust-rls-real-db.test.ts already made for this identical bug on
 * the RLS fix. These tests therefore assert only that the ROLE GATE itself
 * passes the intended roles through (statusCode !== 403) rather than that
 * the full response succeeds end to end (today it still 500s downstream).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-9999-4000-8000-00000000dt01";

function token(roles: string[]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}

// UAT W6-A: /devices/:deviceId/activity now answers 404 for a device this tenant never
// registered, so the "allows <role> (200)" cases need a real trusted_devices row.
const DEVICE_ROW_ID = randomUUID();
async function asTenantSql<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [TENANT]);
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}
beforeAll(async () => {
  await asTenantSql((sql) => sql.unsafe(
    "INSERT INTO hrms.trusted_devices (id, tenant_id, user_id, device_id) VALUES ($1, $2, $3, 'some-device-id') ON CONFLICT DO NOTHING",
    [DEVICE_ROW_ID, TENANT, randomUUID()],
  ));
});

afterAll(async () => {
  await asTenantSql((sql) => sql.unsafe("DELETE FROM hrms.trusted_devices WHERE id = $1", [DEVICE_ROW_ID]));
  await sqlClient.end();
});

describe("GET /v1/hrms/devices/admin -- authz (hr_admin/it_admin/super_admin only)", () => {
  it("rejects a plain employee with 403, not 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/devices/admin",
      headers: { authorization: `Bearer ${token(["employee"])}` },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("rejects a manager with 403 -- not in the allowed role set", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/devices/admin",
      headers: { authorization: `Bearer ${token(["manager"])}` },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  // See the file header note: these three assert the role gate passes the
  // intended roles through (not 403), not a full 200 -- a separate,
  // pre-existing, already-documented bug in this route's LEFT JOIN causes a
  // downstream 500 for every caller regardless of role, and fixing it is
  // out of scope for this authz change.
  it("allows hr_admin past the role gate (not 403)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/devices/admin",
      headers: { authorization: `Bearer ${token(["hr_admin"])}` },
    });
    await app.close();
    expect(r.statusCode).not.toBe(403);
  });

  it("allows it_admin past the role gate (not 403)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/devices/admin",
      headers: { authorization: `Bearer ${token(["it_admin"])}` },
    });
    await app.close();
    expect(r.statusCode).not.toBe(403);
  });

  it("allows super_admin past the role gate (not 403)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/devices/admin",
      headers: { authorization: `Bearer ${token(["super_admin"])}` },
    });
    await app.close();
    expect(r.statusCode).not.toBe(403);
  });
});

describe("GET /v1/hrms/devices/:deviceId/activity -- UAT W6-A validation", () => {
  it("400 for a device id shorter than the registered minimum", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/devices/abc/activity", headers: { authorization: `Bearer ${token(["hr_admin"])}` } });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("404 for a device this tenant never registered (was 200 [])", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/devices/not-a-uuid/activity", headers: { authorization: `Bearer ${token(["hr_admin"])}` } });
    await app.close();
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("DEVICE_NOT_FOUND");
  });
});

describe("GET /v1/hrms/devices/:deviceId/activity -- authz (hr_admin/it_admin/super_admin only)", () => {
  it("rejects a plain employee with 403, not 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/devices/some-device-id/activity",
      headers: { authorization: `Bearer ${token(["employee"])}` },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("rejects a manager with 403 -- not in the allowed role set", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/devices/some-device-id/activity",
      headers: { authorization: `Bearer ${token(["manager"])}` },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("allows hr_admin (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/devices/some-device-id/activity",
      headers: { authorization: `Bearer ${token(["hr_admin"])}` },
    });
    await app.close();
    expect(r.statusCode).toBe(200);
  });

  it("allows it_admin (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/devices/some-device-id/activity",
      headers: { authorization: `Bearer ${token(["it_admin"])}` },
    });
    await app.close();
    expect(r.statusCode).toBe(200);
  });

  it("allows super_admin (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/devices/some-device-id/activity",
      headers: { authorization: `Bearer ${token(["super_admin"])}` },
    });
    await app.close();
    expect(r.statusCode).toBe(200);
  });
});
