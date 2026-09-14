/**
 * SEC-021 — real, cross-process, real-DB proof that an ordinary JWT-authenticated
 * mutating request produces an hrms-service audit-log row with a real, non-null
 * actor id, end to end.
 *
 * Before this fix, `hrms-service`'s `createAuditHook()` (`shared/audit-log.ts`)
 * read the actor off `req.headers["x-actor-id"]`, which `jwt-edge.ts` — the JWT
 * path ordinary browser/session users go through — never set at all (only
 * `api-key-auth.ts` did, on its own separate path). Every audit-log row written
 * for a JWT-authenticated request therefore had a missing/null actor.
 *
 * The actual gap was two-fold, both fixed here:
 *  1. jwt-edge.ts never set x-actor-id from the verified token's `sub` claim
 *     (the gap as originally filed).
 *  2. app.ts's FORWARD_HEADERS allowlist — the generic proxy's header-copy loop
 *     — never included "x-actor-id" at all, so even a correctly-set header
 *     (from EITHER auth path) was silently dropped before the outgoing fetch to
 *     any upstream service. Fixing only (1) still produces a null actor end to
 *     end; this test only passes with both halves in place.
 *
 * Per this gap's own DoD ("verified end-to-end ... not just header-presence,
 * the same way SEC-010's own audit-log regression test does"), this combines
 * SEC-024's real-subprocess/real-HTTP pattern (hrms-service is spawned here as
 * an actual child process, real `tsx src/index.ts`, listening on a real loopback
 * port, backed by the real disposable Postgres this run bootstrapped — nothing
 * here stubs global fetch or mocks jwt-edge.ts/app.ts) with SEC-010's own
 * pattern of polling the real `employee.hrms_audit_log` table for the row a
 * real request should have produced, rather than asserting the hook merely
 * didn't throw or that a header was present on some intermediate object.
 *
 * The request below carries ONLY an Authorization bearer token — no
 * x-tenant-id/x-actor-id headers are set by the test itself (unlike SEC-010's
 * own test, which sets both explicitly specifically because this gap existed
 * and its own comment says so) — so every header the upstream hrms-service
 * child receives is whatever the real, unmodified gateway pipeline
 * (jwt-edge.ts -> proxyHandler -> fetch) actually produced.
 *
 * DB-gated: skipped unless a reachable Postgres is present (same convention
 * identity-service's own *.db.test.ts files and SEC-024's test use).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createSqlClient } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const RUN_DB = process.env.DATABASE_URL ?? process.env.DB_URL;

// Points at the SAME disposable Postgres this SEC-021 run bootstrapped via
// scripts/ci/bootstrap-postgres.sh. Never the shared civitasone-postgres
// (:5435) default other configs fall back to -- this suite refuses to run at
// all without an explicit override (see RUN_DB above).
//
// SEC-028: that refusal can NOT be enforced by checking that DATABASE_URL/
// DB_URL are merely *set* (RUN_DB above) -- gateway-service's own
// vitest.config.ts unconditionally shadowed DATABASE_URL from
// GATEWAY_DATABASE_URL with a hardcoded ":5435" fallback in every
// environment until REL-035, and even after REL-035, an explicit
// GATEWAY_DATABASE_URL/DATABASE_URL/DB_URL override can still simply be set
// BY MISTAKE to the shared instance's own host:port -- presence alone
// (RUN_DB) proves nothing either way. Same root cause SEC-026 already fixed
// in sec-024-verify-real-http.test.ts, for the identical vitest.config.ts
// shadow, against this file's hrms-service target instead of
// identity-service. The real guard is the actually-resolved port check in
// beforeAll below.
const PG_HOST_PORT = (process.env.DATABASE_URL ?? process.env.DB_URL ?? "").match(/@([^/]+)\//)?.[1];
// The shared civitasone-postgres instance's docker-mapped port, and
// vitest.config.ts's own hardcoded CI/GATEWAY_DATABASE_URL fallback -- see
// the SEC-028 note above.
const SHARED_INSTANCE_PORT = "5435";
// IN_CI is deliberately exempted from the port-5435 refusal below. Per
// REL-035 (services/gateway-service/vitest.config.ts), ci.yml's `test` and
// `integration-tests` jobs never export GATEWAY_DATABASE_URL and rely
// entirely on this exact port matching that job's own freshly-created,
// disposable Postgres service container -- a DIFFERENT container every run,
// despite sharing this port number by repo-wide convention ("Postgres on
// host port 5435 matches vitest defaults per service", ci.yml). From inside
// this process, a real CI container on :5435 and this dev host's real
// long-lived shared instance on :5435 are indistinguishable by port alone --
// refusing unconditionally would also refuse CI's own legitimate disposable
// database, not just the dev-host risk this gap is actually about.
const IN_CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

const HRMS_DIR = path.resolve(__dirname, "../../hrms-service");
const JWT_SECRET = "test_secret_for_civitasone_32chr";

// Same fixture tenant/department/designation ids as
// hrms-service/tests/sec-010-hrms-audit-log.integration.test.ts and
// hrms-service/tests/fixtures/core-seed.ts's own FIN/IAS rows.
const TENANT = "00000000-0000-0000-0000-000000000001";
const DEPARTMENT = "eeeeeeee-0001-0000-0000-000000000001";
const DESIGNATION = "eeeeeeee-0001-0000-0000-000000000003";
const SEED_ACTOR = "00000000-0000-0000-0000-000000000099";
// The actor THIS test's own request authenticates as -- distinct from
// SEED_ACTOR so a passing assertion genuinely proves this exact id made it
// through jwt-edge.ts -> proxyHandler -> hrms-service -> createAuditHook,
// not merely that some fixture actor happened to already be in scope.
const REQUEST_ACTOR = "00000000-0000-0000-0000-0000000b2421";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const p = addr.port;
        srv.close(() => resolve(p));
      } else {
        srv.close(() => reject(new Error("could not allocate a free port")));
      }
    });
  });
}

async function waitUntilReady(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`hrms-service did not become ready at ${url} within ${timeoutMs}ms: ${String(lastErr)}`);
}

// FLAKY-SKIP: Requires DATABASE_URL/DB_URL against a real Postgres for the SEC-021 real-HTTP audit-log assertion; unset in standard CI so this suite never executes there. (expires: 2026-12-13)
describe.skipIf(!RUN_DB)("SEC-021 — jwt-edge x-actor-id -> real hrms audit-log row, real HTTP", () => {
  let hrmsProc: ChildProcess;
  let hrmsPort: number;
  let seedSql: ReturnType<typeof createSqlClient>;
  let gatewayApp: FastifyInstance;

  beforeAll(async () => {
    if (!PG_HOST_PORT) {
      throw new Error("DATABASE_URL/DB_URL must point at the disposable test Postgres for this suite");
    }

    // SEC-028: presence of DATABASE_URL/DB_URL (above) proves nothing -- see
    // the note above PG_HOST_PORT/SHARED_INSTANCE_PORT. Check the
    // actually-resolved port instead of trusting presence, exactly as
    // SEC-026 already does in sec-024-verify-real-http.test.ts (IN_CI is the
    // one deliberate addition -- see its own comment for why). Failing here
    // is immediate and before spawning hrms-service or touching the database
    // at all. Reproduced directly (safely, via a decoy database name so no
    // real write occurred): today, with no port check, an unguarded run
    // against the shared instance does NOT fail closed by design the way
    // SEC-024's missing-relation crash did -- it reaches a real spawned
    // hrms-service subprocess and a real seedSql INSERT attempt, stopped
    // only by an incidental credential mismatch in that reproduction, not by
    // anything this file itself does.
    const resolvedPort = PG_HOST_PORT.split(":").pop();
    if (resolvedPort === SHARED_INSTANCE_PORT && !IN_CI) {
      throw new Error(
        `Refusing to run: DATABASE_URL/DB_URL resolves to port ${SHARED_INSTANCE_PORT} ` +
          "(gateway-service/vitest.config.ts's own fallback for the SHARED civitasone-postgres " +
          "instance), not a disposable test database. No explicit override is set. Export " +
          "GATEWAY_DATABASE_URL to point at a disposable Postgres bootstrapped via " +
          "scripts/ci/bootstrap-postgres.sh before running this suite.",
      );
    }

    hrmsPort = await getFreePort();

    // Real subprocess: same entrypoint (src/index.ts, buildApp + listen) as
    // dev/prod use, run via the same tsx hrms-service already depends on.
    // This is a true black box reached only over HTTP -- nothing here imports
    // hrms-service's own src, mirroring SEC-024's identity-service spawn.
    hrmsProc = spawn(
      path.join(HRMS_DIR, "node_modules/.bin/tsx"),
      ["src/index.ts"],
      {
        cwd: HRMS_DIR,
        env: {
          ...process.env,
          PORT: String(hrmsPort),
          BIND_HOST: "127.0.0.1",
          DATABASE_URL: `postgres://hrms_svc:hrms_dev_pw@${PG_HOST_PORT}/civitas_hrms`,
          DB_URL: `postgres://hrms_svc:hrms_dev_pw@${PG_HOST_PORT}/civitas_hrms`,
          QUEUE_DRIVER: "memory",
          CACHE_DRIVER: "memory",
          JWT_ALGORITHM: "HS256",
          JWT_SECRET,
          // Matches hrms-service/vitest.config.ts's own readPiiKey() fallback
          // exactly, so this child behaves identically to hrms-service's own
          // test runs.
          PII_ENC_KEY: "civitasone-hrms-pii-dev-key-not-for-prod",
          LOG_LEVEL: "warn",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let startupLog = "";
    hrmsProc.stdout?.on("data", (d) => { startupLog += String(d); });
    hrmsProc.stderr?.on("data", (d) => { startupLog += String(d); });
    hrmsProc.on("exit", (code, signal) => {
      if (code !== null && code !== 0) {
        // eslint-disable-next-line no-console
        console.error(`hrms-service subprocess exited early (code=${code}, signal=${signal}):\n${startupLog}`);
      }
    });

    await waitUntilReady(`http://127.0.0.1:${hrmsPort}/health`);

    // Seed the minimal department/designation fixtures POST /v1/hrms/employees
    // needs, directly against the disposable Postgres as the actual Postgres
    // superuser (bypasses FORCE RLS for setup only -- the code path under
    // test, createAuditHook's own insert, still runs through hrms_svc under
    // normal RLS enforcement via runWithTenant/db.transaction). Same two rows
    // (by id/code) as hrms-service/tests/fixtures/core-seed.ts's FIN/IAS
    // fixture, kept minimal (no employees/leave/attendance -- this test only
    // needs a department and designation to exist).
    seedSql = createSqlClient(`postgres://civitas:civitas_test@${PG_HOST_PORT}/civitas_hrms`);
    await seedSql`
      INSERT INTO employee.hrms_departments
        (id, tenant_id, code, name, parent_id, created_at, updated_at, created_by, updated_by, version)
      VALUES
        (${DEPARTMENT}, ${TENANT}, 'FIN', 'Finance', null, now(), now(), ${SEED_ACTOR}, ${SEED_ACTOR}, 1)
      ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, updated_at = now()
    `;
    await seedSql`
      INSERT INTO employee.hrms_designations
        (id, tenant_id, code, name, level, pay_grade, created_at, updated_at, created_by, updated_by, version)
      VALUES
        (${DESIGNATION}, ${TENANT}, 'IAS', 'IAS Officer', 1, 'L14', now(), now(), ${SEED_ACTOR}, ${SEED_ACTOR}, 1)
      ON CONFLICT (id) DO NOTHING
    `;

    // Point the real, unmodified gateway app at the real hrms-service child.
    // registry.ts's SERVICE_ROUTES reads GATEWAY_HRMS_URL at module-load time,
    // so this MUST be set before app.js (which imports registry.js) is first
    // imported -- hence the dynamic import below, not a static top-of-file one
    // (same reasoning as SEC-024's dynamic import of api-key-auth.js after
    // setting IDENTITY_SERVICE_URL).
    process.env.GATEWAY_HRMS_URL = `http://127.0.0.1:${hrmsPort}`;
    process.env.JWT_ALGORITHM = "HS256";
    process.env.JWT_SECRET = JWT_SECRET;

    const { buildApp } = await import("../src/app.js");
    gatewayApp = await buildApp();
  }, 45_000);

  afterAll(async () => {
    await gatewayApp?.close();
    await seedSql?.end({ timeout: 5 });
    if (hrmsProc && !hrmsProc.killed) {
      hrmsProc.kill("SIGTERM");
      await new Promise((resolve) => {
        const t = setTimeout(() => { hrmsProc.kill("SIGKILL"); resolve(undefined); }, 5_000);
        hrmsProc.once("exit", () => { clearTimeout(t); resolve(undefined); });
      });
    }
  }, 15_000);

  /** Poll employee.hrms_audit_log for a row this test's own request should have produced. */
  async function findAuditRow(opts: { action: string; resourceType: string; since: string }) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const rows = await seedSql`
        SELECT tenant_id, actor_id, action, resource_type, resource_id, created_at
        FROM employee.hrms_audit_log
        WHERE tenant_id = ${TENANT}
          AND action = ${opts.action}
          AND resource_type = ${opts.resourceType}
          AND created_at >= ${opts.since}::timestamptz
        ORDER BY created_at DESC
        LIMIT 1
      `;
      if (rows.length > 0) return rows[0];
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }

  it("an ordinary JWT-authenticated employee-create request produces a real hrms_audit_log row with a real, non-null actor id", async () => {
    const token = signToken(
      { sub: REQUEST_ACTOR, tid: TENANT, roles: ["super_admin", "hr_admin"], sid: "sec-021-e2e" },
      JWT_SECRET,
      3600,
    );
    const since = new Date().toISOString();
    const employeeNo = `SEC021E2E-${randomUUID().slice(0, 8)}`;

    // Through the REAL gateway proxy route (/api/v1/hrms/... -> /v1/hrms/...
    // on the real hrms-service child), authenticated ONLY by the bearer
    // token -- no x-tenant-id/x-actor-id set here, unlike SEC-010's own test.
    const res = await gatewayApp.inject({
      method: "POST",
      url: "/api/v1/hrms/employees",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {
        employeeNo,
        fullName: "SEC-021 E2E Regression",
        departmentId: DEPARTMENT,
        designationId: DESIGNATION,
        dateOfJoining: "2026-01-01",
        basicMinor: 1000000,
      },
    });

    expect(res.statusCode).toBe(202);

    // createAuditHook() maps POST -> "create" and derives resourceType from
    // the URL's 3rd segment: /v1/hrms/employees -> "employees" (same mapping
    // SEC-010's own test relies on).
    const row = await findAuditRow({ action: "create", resourceType: "employees", since });

    // The literal DoD: a real row must exist, with a real, non-null actor id
    // that matches the JWT this test signed -- not merely that the request
    // succeeded or that some header was present on an intermediate object.
    expect(row).not.toBeNull();
    expect(row!.tenant_id).toBe(TENANT);
    expect(row!.actor_id).not.toBeNull();
    expect(row!.actor_id).toBe(REQUEST_ACTOR);
    expect(row!.action).toBe("create");
    expect(row!.resource_type).toBe("employees");
  }, 20000);
});
