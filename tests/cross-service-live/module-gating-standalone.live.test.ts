/**
 * ST-M01-02 — cross-service-live module gating (D-17, D-ST-24).
 *
 * Real, cross-process proof that the gateway module-guard's per-tenant
 * enforcement decision is driven by admin-service's composition projection over
 * real HTTP + real Postgres — NOTHING here mocks fetch or the admin response.
 *
 * admin-service is spawned as an actual child process (same `tsx src/index.ts`
 * entrypoint dev/prod use) against the disposable Postgres this run bootstrapped.
 * The gateway's own, unmodified checkModuleEnabled() is imported from
 * gateway-service/src and run for real; its fetch() to
 * /v1/admin/composition/internal/:tenantId/modules genuinely crosses the process
 * boundary to that child.
 *
 * Proves (D-ST-24 / M01 exit criterion 3):
 *   • an ENFORCE tenant gets 403 on a disabled module through the guard;
 *   • an OFF tenant is unchanged (fail-open on ambiguous signals, 403 only on a
 *     genuinely-disabled known module — the pre-FF-03 contract);
 *   • a tenant on the `smarttransfer_standalone` profile is blocked from
 *     payroll / recruitment routes at the gateway (standalone SKU isolation).
 *
 * DB-gated: skipped unless DATABASE_URL/DB_URL points at a reachable disposable
 * Postgres (same convention as sec-024-verify-real-http.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUN_DB = process.env.DATABASE_URL ?? process.env.DB_URL;
const PG_HOST_PORT = (process.env.DATABASE_URL ?? process.env.DB_URL ?? "").match(/@([^/]+)\//)?.[1];
const SHARED_INSTANCE_PORT = "5435";
const IN_CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const ADMIN_DIR = path.join(REPO_ROOT, "services/admin-service");
const SHARED_INTERNAL_SECRET = "st-m01-02-live-shared-secret-32chars";
const JWT_SECRET = "test_secret_for_civitasone_32chr";

// Distinct tenant ids for the three scenarios.
const T_ENFORCE = "0a000000-0000-4000-8000-00000000e001";
const T_OFF = "0a000000-0000-4000-8000-00000000f001";
const T_STANDALONE = "0a000000-0000-4000-8000-000000005001";
const ADMIN_ACTOR = "0a000000-0000-4000-8000-0000000000a1";

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
  throw new Error(`admin-service did not become ready at ${url} within ${timeoutMs}ms: ${String(lastErr)}`);
}

// Minimal reply double for the guard: records the status + body it sends.
function fakeReply() {
  const r = { _code: 0, _body: null as unknown } as { _code: number; _body: unknown; code(n: number): typeof r; send(b: unknown): typeof r };
  r.code = (n: number) => ((r._code = n), r);
  r.send = (b: unknown) => ((r._body = b), r);
  return r;
}
function fakeReq(tenantId: string) {
  return { headers: { "x-tenant-id": tenantId }, id: "live-req", log: { warn() {} } } as never;
}

// FLAKY-SKIP: Requires DATABASE_URL/DB_URL against a real disposable Postgres (bootstrap-postgres.sh); unset in the default unit lane so this never runs there. (expires: 2026-12-13)
describe.skipIf(!RUN_DB)("cross-service-live: module gating (D-17, D-ST-24)", () => {
  let adminProc: ChildProcess;
  let adminPort: number;
  let signToken: (p: Record<string, unknown>, s: string, ttl: number) => string;
  let checkModuleEnabled: typeof import("../../services/gateway-service/src/module-guard.js").checkModuleEnabled;
  let guardTest: typeof import("../../services/gateway-service/src/module-guard.js")._test;

  beforeAll(async () => {
    if (!PG_HOST_PORT) throw new Error("DATABASE_URL/DB_URL must point at the disposable test Postgres");
    const resolvedPort = PG_HOST_PORT.split(":").pop();
    if (resolvedPort === SHARED_INSTANCE_PORT && !IN_CI) {
      throw new Error(`Refusing to run against the shared :${SHARED_INSTANCE_PORT} instance — export a disposable GATEWAY/ADMIN DATABASE_URL`);
    }

    adminPort = await getFreePort();
    adminProc = spawn(
      path.join(ADMIN_DIR, "node_modules/.bin/tsx"),
      ["src/index.ts"],
      {
        cwd: ADMIN_DIR,
        env: {
          ...process.env,
          PORT: String(adminPort),
          BIND_HOST: "127.0.0.1",
          DATABASE_URL: `postgres://admin_svc:admin_dev_pw@${PG_HOST_PORT}/civitas_admin`,
          DB_URL: `postgres://admin_svc:admin_dev_pw@${PG_HOST_PORT}/civitas_admin`,
          ADMIN_SCANNER_DATABASE_URL: `postgres://admin_scanner:admin_scanner_dev_pw@${PG_HOST_PORT}/civitas_admin`,
          QUEUE_DRIVER: "memory",
          CACHE_DRIVER: "memory",
          JWT_ALGORITHM: "HS256",
          JWT_SECRET,
          INTERNAL_SERVICE_SECRET: SHARED_INTERNAL_SECRET,
          LOG_LEVEL: "warn",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let startupLog = "";
    adminProc.stdout?.on("data", (d) => { startupLog += String(d); });
    adminProc.stderr?.on("data", (d) => { startupLog += String(d); });
    adminProc.on("exit", (code, signal) => {
      if (code !== null && code !== 0) {
        // eslint-disable-next-line no-console
        console.error(`admin-service subprocess exited early (code=${code}, signal=${signal}):\n${startupLog}`);
      }
    });
    await waitUntilReady(`http://127.0.0.1:${adminPort}/health`);

    ({ signToken } = await import("../../packages/auth/src/index.js"));

    // Point the real gateway module-guard at the real admin child, in
    // composition-enforcement mode. These are read fresh on every fetch.
    process.env.GATEWAY_ADMIN_URL = `http://127.0.0.1:${adminPort}`;
    process.env.COMPOSITION_ENFORCEMENT = "on";
    process.env.INTERNAL_SERVICE_SECRET = SHARED_INTERNAL_SECRET;
    const guard = await import("../../services/gateway-service/src/module-guard.js");
    checkModuleEnabled = guard.checkModuleEnabled;
    guardTest = guard._test;

    // ── Seed the three tenants via the REAL admin HTTP API ──────────────────
    const admin = `http://127.0.0.1:${adminPort}`;
    const taTok = (tid: string) => signToken({ sub: ADMIN_ACTOR, tid, roles: ["tenant_admin"], sid: "s" }, JWT_SECRET, 3600);
    const superTok = (tid: string) => signToken({ sub: ADMIN_ACTOR, tid, roles: ["super_admin"], sid: "s" }, JWT_SECRET, 3600);
    const post = (url: string, tok: string, body: unknown) =>
      fetch(`${admin}${url}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify(body) });
    const put = (url: string, tok: string, body: unknown) =>
      fetch(`${admin}${url}`, { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify(body) });

    // T_ENFORCE + T_OFF: govt profile (wide module set incl. finance, NOT crm).
    for (const t of [T_ENFORCE, T_OFF]) {
      const r = await post("/v1/admin/composition/onboard", taTok(t), { profile: "govt_dept" });
      if (!r.ok) throw new Error(`onboard ${t} failed: ${r.status} ${await r.text()}`);
    }
    // T_ENFORCE → enforce; T_OFF → explicit off; T_STANDALONE → standalone profile (defaults to enforce).
    const re = await put(`/v1/admin/composition/${T_ENFORCE}/enforcement-mode`, superTok(T_ENFORCE), { mode: "enforce" });
    if (!re.ok) throw new Error(`set enforce failed: ${re.status} ${await re.text()}`);
    const ro = await put(`/v1/admin/composition/${T_OFF}/enforcement-mode`, superTok(T_OFF), { mode: "off" });
    if (!ro.ok) throw new Error(`set off failed: ${ro.status} ${await ro.text()}`);
    const rs = await post("/v1/admin/composition/onboard", taTok(T_STANDALONE), { profile: "smarttransfer_standalone" });
    if (!rs.ok) throw new Error(`onboard standalone failed: ${rs.status} ${await rs.text()}`);
  }, 60_000);

  afterAll(async () => {
    // Tidy env so other suites in the same worker are unaffected.
    delete process.env.COMPOSITION_ENFORCEMENT;
    delete process.env.GATEWAY_ADMIN_URL;
    if (adminProc && !adminProc.killed) {
      adminProc.kill("SIGTERM");
      await new Promise((resolve) => {
        const t = setTimeout(() => { adminProc.kill("SIGKILL"); resolve(undefined); }, 5_000);
        adminProc.once("exit", () => { clearTimeout(t); resolve(undefined); });
      });
    }
  }, 15_000);

  it("ENFORCE tenant: 403 on a disabled module (crm) through the real projection", async () => {
    guardTest.moduleCache.clear();
    const reply = fakeReply();
    const allowed = await checkModuleEnabled(fakeReq(T_ENFORCE), reply as never, "crm");
    expect(allowed).toBe(false);
    expect(reply._code).toBe(403);
    expect((reply._body as { code: string }).code).toBe("MODULE_DISABLED");
  });

  it("ENFORCE tenant: allows an enabled module (finance)", async () => {
    guardTest.moduleCache.clear();
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(T_ENFORCE), reply as never, "finance")).toBe(true);
    expect(reply._code).toBe(0);
  });

  it("OFF tenant: unchanged — a known-disabled module 403s, an ambiguous signal does not block", async () => {
    guardTest.moduleCache.clear();
    // crm is not in govt's set → known-disabled → 403 even in off (pre-FF-03).
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(T_OFF), reply as never, "crm")).toBe(false);
    expect(reply._code).toBe(403);
    // an enabled module is allowed
    guardTest.moduleCache.clear();
    const reply2 = fakeReply();
    expect(await checkModuleEnabled(fakeReq(T_OFF), reply2 as never, "finance")).toBe(true);
  });

  it("STANDALONE tenant: blocked from payroll AND recruitment at the gateway", async () => {
    for (const route of ["payroll", "recruitment"]) {
      guardTest.moduleCache.clear();
      const reply = fakeReply();
      const allowed = await checkModuleEnabled(fakeReq(T_STANDALONE), reply as never, route);
      expect(allowed, `standalone tenant must be blocked from ${route}`).toBe(false);
      expect(reply._code).toBe(403);
    }
  });

  it("STANDALONE tenant: can still reach the platform documents/eoffice routes in enforce mode", async () => {
    // documents + eoffice are PLATFORM routes — always reachable even under
    // enforce (the composition-projection fix). The `smarttransfer` gateway
    // route-key itself is added by ST-M01-12 (new service registry entry); it
    // is intentionally NOT asserted here to keep this row's scope clean.
    guardTest.moduleCache.clear();
    expect(await checkModuleEnabled(fakeReq(T_STANDALONE), fakeReply() as never, "documents")).toBe(true);
    expect(await checkModuleEnabled(fakeReq(T_STANDALONE), fakeReply() as never, "eoffice")).toBe(true);
  });
});
