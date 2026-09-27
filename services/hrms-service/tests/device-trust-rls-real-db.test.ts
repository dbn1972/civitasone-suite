/**
 * Device Trust — real-DB regression test for the raw-SQL RLS/tenant-GUC gap.
 *
 * WHY THIS EXISTS: modules/device-trust/routes.ts queries hrms.trusted_devices,
 * hrms.device_activity_log and hrms.device_policies -- all RLS ENABLEd AND
 * FORCEd (migration 0123_rls_completeness.sql) -- via the sqlPool adapter
 * (shared/db.ts), which is a bare sqlClient.unsafe() call with no
 * app.tenant_id GUC set. Under hrms_svc (NOBYPASSRLS, NOSUPERUSER -- verified
 * below), every SELECT through sqlPool silently returns zero rows and every
 * UPDATE silently affects zero rows -- neither raises an error, because the
 * USING clause simply excludes every row when current_tenant_id() is NULL.
 *
 * Concretely: PATCH /v1/hrms/devices/:id/block runs
 *   UPDATE hrms.trusted_devices SET trust_status = 'blocked' ... WHERE id = $3 AND tenant_id = $4
 * which matches zero rows under RLS with no GUC set, so the device's
 * trust_status in the database never actually changes -- while the route
 * still replies 200 { status: "blocked" }. POST /v1/hrms/devices/heartbeat's
 * own blocked-device SELECT has the identical gap, so a device that HAD been
 * persisted as blocked would still read back here as trusted. This is the
 * fleet-wide `withRawTenantGuc` gap already fixed the same way in
 * social/routes.ts, social/pulse-routes.ts, medical/routes.ts,
 * id-cards/routes.ts, workforce-planning/routes.ts and
 * gap-features/performance-dev-routes.ts -- device-trust never received it
 * (see packages/db/src/raw-tenant-guc.ts's own header and PR #1560's commit
 * message, which named device-trust explicitly as one of the modules using
 * this exact sqlPool shape whose tenant-scoping was still unaudited).
 *
 * This test seeds devices directly via withRawTenantGuc (the correct,
 * already-established pattern) so seeding itself is not confounded by the
 * bug under test, then drives the real Fastify app over app.inject() calls
 * -- proving the actual route behaviour against a real Postgres, not a mock.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "dddddddd-0019-4000-8000-000000000019";
const USER_ID = "dddddddd-0019-4000-8000-0000000000e1";
const ADMIN_ID = "dddddddd-0019-4000-8000-0000000000a1";

function tok(roles: string[], sub: string) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-device-trust-test" }, SECRET);
}

const adminToken = tok(["hr_admin"], ADMIN_ID);
const userToken = tok(["employee"], USER_ID);

let app: Awaited<ReturnType<typeof buildApp>>;

// hrms.trusted_devices is FORCE RLS: this test's own seed/verification
// queries need the same app.tenant_id GUC the fixed route now sets via
// withRawTenantGuc, or Postgres hides everything from them exactly like the
// unfixed route used to.
function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM hrms.device_activity_log WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM hrms.trusted_devices WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM hrms.device_policies WHERE tenant_id = ${TENANT}`);
}

async function seedDevice(opts: { id: string; deviceId: string; trustStatus?: string }): Promise<void> {
  await asTenant((tx) => tx`
    INSERT INTO hrms.trusted_devices
      (id, tenant_id, user_id, device_id, device_name, platform, os_version, app_version, trust_status)
    VALUES
      (${opts.id}, ${TENANT}, ${USER_ID}, ${opts.deviceId}, 'Test Device', 'android', '14', '1.0.0', ${opts.trustStatus ?? "trusted"})
  `);
}

beforeAll(async () => {
  // Fail fast with an actionable message if this environment's migrations
  // were never applied, instead of every test below drowning in a raw 42P01.
  const [row] = await sqlClient<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'hrms' AND table_name = 'trusted_devices'
    ) AS present
  `;
  if (!row?.present) {
    throw new Error(
      "hrms.trusted_devices does not exist in this database (DATABASE_URL=" +
        `${process.env.DATABASE_URL ?? "<default from vitest.config.ts>"}). ` +
        "Apply services/hrms-service/migrations/0019_device_trust.sql and " +
        "0123_rls_completeness.sql (npx drizzle-kit migrate, per migrations/README.md) before running this suite.",
    );
  }

  // RLS-testing rigor: this service's connecting role must genuinely be
  // NOSUPERUSER/NOBYPASSRLS, or every assertion below is meaningless -- a
  // superuser/BYPASSRLS connection ignores FORCE RLS entirely, so the exact
  // bug this suite exists to catch (and guard against regressing) could never
  // reproduce and every "trust_status is really blocked in the DB" assertion
  // would pass for the wrong reason.
  const [role] = await sqlClient<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
  `;
  if (!role || role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `Expected hrms-service's connecting role (current_user) to be NOSUPERUSER/NOBYPASSRLS, got ` +
        `rolsuper=${role?.rolsuper} rolbypassrls=${role?.rolbypassrls}. This suite's assertions are ` +
        "meaningless against a role that bypasses row-level security.",
    );
  }

  await cleanup();
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("device-trust — FORCE RLS tenant-GUC regression (raw sqlPool queries)", () => {
  it("a device blocked via PATCH /:id/block is genuinely persisted as blocked, and heartbeat then rejects it", async () => {
    const deviceRowId = randomUUID();
    const deviceId = `blocked-device-${randomUUID()}`;
    await seedDevice({ id: deviceRowId, deviceId, trustStatus: "trusted" });

    const blockRes = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/devices/${deviceRowId}/block`,
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "lost phone" }),
    });
    expect(blockRes.statusCode).toBe(200);

    // The real check is not what the route SAID, but what actually landed in
    // the database, read back through a correctly tenant-scoped query. Under
    // the bug, this UPDATE silently matched zero rows, so trust_status here
    // would still read "trusted".
    const [dbRow] = await asTenant((tx) => tx`
      SELECT trust_status, blocked_reason FROM hrms.trusted_devices WHERE id = ${deviceRowId}
    `);
    if (!dbRow) throw new Error(`expected a row in hrms.trusted_devices for id ${deviceRowId}`);
    expect(dbRow.trust_status).toBe("blocked");
    expect(dbRow.blocked_reason).toBe("lost phone");

    // The actual security-relevant behaviour: the device must now be turned
    // away at the door, not silently let back in because the blocked-status
    // SELECT inside heartbeat couldn't see the block either.
    const heartbeatRes = await app.inject({
      method: "POST",
      url: "/v1/hrms/devices/heartbeat",
      headers: { authorization: `Bearer ${userToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        deviceId,
        deviceName: "Test Device",
        platform: "android",
        osVersion: "14",
        appVersion: "1.0.0",
      }),
    });
    expect(heartbeatRes.statusCode).toBe(403);
    expect(JSON.parse(heartbeatRes.body).code).toBe("DEVICE_BLOCKED");

    // And unblock must be equally real: not just a 200, but a genuine flip
    // back to 'trusted' in the database, after which heartbeat succeeds again.
    const unblockRes = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/devices/${deviceRowId}/unblock`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(unblockRes.statusCode).toBe(200);

    const [afterUnblock] = await asTenant((tx) => tx`
      SELECT trust_status, blocked_reason FROM hrms.trusted_devices WHERE id = ${deviceRowId}
    `);
    if (!afterUnblock) throw new Error(`expected a row in hrms.trusted_devices for id ${deviceRowId}`);
    expect(afterUnblock.trust_status).toBe("trusted");
    expect(afterUnblock.blocked_reason).toBeNull();

    const heartbeatAfterUnblock = await app.inject({
      method: "POST",
      url: "/v1/hrms/devices/heartbeat",
      headers: { authorization: `Bearer ${userToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        deviceId,
        deviceName: "Test Device",
        platform: "android",
        osVersion: "14",
        appVersion: "1.0.0",
      }),
    });
    expect(heartbeatAfterUnblock.statusCode).toBe(200);
  });

  it("a legitimate, never-blocked device reporting in for the first time is correctly treated as trusted (the fix must not fail closed on good devices)", async () => {
    const deviceId = `trusted-device-${randomUUID()}`;

    const heartbeatRes = await app.inject({
      method: "POST",
      url: "/v1/hrms/devices/heartbeat",
      headers: { authorization: `Bearer ${userToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        deviceId,
        deviceName: "Test Device",
        platform: "android",
        osVersion: "14",
        appVersion: "1.0.0",
        isRooted: false,
        hasScreenLock: true,
        biometricAvailable: true,
      }),
    });
    expect(heartbeatRes.statusCode).toBe(200);
    const body = JSON.parse(heartbeatRes.body);
    expect(body.trustStatus).toBe("trusted");
    expect(body.compliant).toBe(true);

    // Prove the heartbeat's own INSERT actually reached the real table under
    // RLS, not just that the HTTP layer said 200.
    const [dbRow] = await asTenant((tx) => tx`
      SELECT trust_status FROM hrms.trusted_devices WHERE tenant_id = ${TENANT} AND device_id = ${deviceId}
    `);
    if (!dbRow) throw new Error(`expected a row in hrms.trusted_devices for device_id ${deviceId}`);
    expect(dbRow.trust_status).toBe("trusted");

    // Reporting in again (the ON CONFLICT DO UPDATE branch) must keep
    // treating this same legitimate device as trusted, not accidentally
    // flip it to blocked/flagged.
    const secondHeartbeat = await app.inject({
      method: "POST",
      url: "/v1/hrms/devices/heartbeat",
      headers: { authorization: `Bearer ${userToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        deviceId,
        deviceName: "Test Device",
        platform: "android",
        osVersion: "14",
        appVersion: "1.0.1",
        isRooted: false,
        hasScreenLock: true,
        biometricAvailable: true,
      }),
    });
    expect(secondHeartbeat.statusCode).toBe(200);
    expect(JSON.parse(secondHeartbeat.body).trustStatus).toBe("trusted");
  });

  it("GET /v1/hrms/devices/me returns the real seeded row (same RLS gap on the read side)", async () => {
    // Note: GET /v1/hrms/devices/admin is deliberately NOT exercised here --
    // it has a separate, pre-existing bug unrelated to tenant-GUC scoping
    // (its LEFT JOIN compares e.user_id to d.user_id, but employee.hrms_employees
    // has no user_id column -- confirmed live, 42703 "column e.user_id does not
    // exist"; employee.hrms_employees links to an actor via user_ref, per
    // hrms-service's other real-DB fixtures). Flagged separately; fixing a
    // wrong column name is out of scope for this tenant-GUC fix.
    const deviceRowId = randomUUID();
    const deviceId = `list-device-${randomUUID()}`;
    await seedDevice({ id: deviceRowId, deviceId, trustStatus: "trusted" });

    const myDevices = await app.inject({
      method: "GET",
      url: "/v1/hrms/devices/me",
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(myDevices.statusCode).toBe(200);
    const myBody = JSON.parse(myDevices.body);
    expect(myBody.data.some((d: any) => d.id === deviceRowId)).toBe(true);
  });
});
