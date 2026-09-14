/**
 * SEC-024 — real, cross-process proof that apiKeyPreHandler's verify call
 * actually reaches identity-service.
 *
 * gateway-service/src/api-key-auth.ts's resolveKeyRecord() calls
 * fetch(`${IDENTITY_URL}/internal/apikeys/verify`, ...). Before this gap's
 * fix, identity-service registered nothing at that path (wrong prefix AND
 * hyphenation vs. what it actually registered), so this always 404d and
 * req.apiKeyAuthenticated could never become true for any key, valid or not.
 *
 * Per the gap's own DoD, this is a REAL HTTP call, not a mock of fetch:
 * identity-service is spawned here as an actual child process (real `tsx
 * src/index.ts`, same entrypoint production/dev use), listening on a real
 * loopback port, backed by the real disposable Postgres this whole SEC-024
 * campaign run bootstrapped. apiKeyPreHandler is imported unmodified from
 * gateway-service's own src and run for real -- its `fetch()` genuinely
 * crosses a process boundary to that child. Nothing here stubs global fetch
 * or mocks api-key-auth.ts.
 *
 * DB-gated: skipped unless a reachable Postgres is present (same convention
 * identity-service's own *.db.test.ts files use).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createSqlClient } from "@civitasone/db";

const RUN_DB = process.env.DATABASE_URL ?? process.env.DB_URL;

// Points at the SAME disposable Postgres the rest of this SEC-024 run
// bootstrapped (scripts/ci/bootstrap-postgres.sh already applied every
// migration, including 0023's identity_scanner grant on apikeys.api_keys).
// Never the shared civitasone-postgres (:5435) default other configs fall
// back to -- this suite refuses to run at all without an explicit override.
//
// SEC-026: that refusal can NOT be enforced by checking that DATABASE_URL/
// DB_URL are merely *set* (RUN_DB/PG_HOST_PORT above) -- gateway-service's
// own vitest.config.ts unconditionally sets DATABASE_URL from
// GATEWAY_DATABASE_URL with a hardcoded ":5435" fallback, so DATABASE_URL is
// ALWAYS defined by the time this file runs, override or not, and it always
// wins the `??` ahead of DB_URL too. The only env var that actually changes
// what DATABASE_URL resolves to is GATEWAY_DATABASE_URL. The real guard is
// the actually-resolved port check in beforeAll below.
const PG_HOST_PORT = (process.env.DATABASE_URL ?? process.env.DB_URL ?? "").match(/@([^/]+)\//)?.[1];
// The shared civitasone-postgres instance's docker-mapped port, and
// vitest.config.ts's own hardcoded fallback -- see the SEC-026 note above.
const SHARED_INSTANCE_PORT = "5435";
// IN_CI is deliberately exempted from the port-5435 refusal below (SEC-028
// regression fix). Per REL-035 (services/gateway-service/vitest.config.ts),
// ci.yml's `test` and `integration-tests` jobs never export
// GATEWAY_DATABASE_URL and rely entirely on this exact port matching that
// job's own freshly-created, disposable Postgres service container -- a
// DIFFERENT container every run, despite sharing this port number by
// repo-wide convention ("Postgres on host port 5435 matches vitest defaults
// per service", ci.yml). From inside this process, a real CI container on
// :5435 and this dev host's real long-lived shared instance on :5435 are
// indistinguishable by port alone -- refusing unconditionally, as this
// guard originally did, refuses CI's own legitimate disposable database too,
// not just the dev-host risk this gap is actually about. Confirmed live:
// this exact guard, unconditional, throws under simulated real CI env
// (CI=true GITHUB_ACTIONS=true, no override) -- meaning the unconditional
// version of this fix was itself breaking the real CI test job it's
// supposed to run cleanly in.
const IN_CI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

const IDENTITY_DIR = path.resolve(__dirname, "../../identity-service");
const SHARED_INTERNAL_SECRET = "sec-024-shared-test-secret-32chars";
const TEST_TENANT = "00000000-0000-0000-0000-0000000b2401";
const TEST_ACTOR = "00000000-0000-0000-0000-0000000b2402";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

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
  throw new Error(`identity-service did not become ready at ${url} within ${timeoutMs}ms: ${String(lastErr)}`);
}

// FLAKY-SKIP: Requires DATABASE_URL/DB_URL against a real Postgres for the SEC-024 real-HTTP path; unset in standard CI so this suite never executes there. (expires: 2026-12-13)
describe.skipIf(!RUN_DB)("SEC-024 — apiKeyPreHandler → identity-service, real HTTP", () => {
  let identityProc: ChildProcess;
  let identityPort: number;
  let seedSql: ReturnType<typeof createSqlClient>;
  let testApp: FastifyInstance;

  let validKey: string;
  let validKeyId: string;
  let inactiveKey: string;

  beforeAll(async () => {
    if (!PG_HOST_PORT) {
      throw new Error("DATABASE_URL/DB_URL must point at the disposable test Postgres for this suite");
    }

    // SEC-026: presence of DATABASE_URL/DB_URL (above) proves nothing --
    // vitest.config.ts's own GATEWAY_DATABASE_URL fallback means DATABASE_URL
    // is set even when no developer ever exported an override, and it
    // resolves to the SHARED civitasone-postgres instance on port 5435. Check
    // the actually-resolved port instead of trusting that presence. Failing
    // here is immediate (before spawning identity-service or touching the
    // database at all) and says exactly what's wrong, instead of leaving a
    // developer to debug a "did not become ready" timeout 30+ seconds later
    // that turns out to be identity-service crashing on a relation the
    // shared DB never migrated.
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

    identityPort = await getFreePort();

    // Real subprocess: same entrypoint (src/index.ts, buildApp + listen) as
    // dev/prod use, run via the same tsx this workspace already depends on
    // (services/identity-service/package.json devDependencies).
    identityProc = spawn(
      path.join(IDENTITY_DIR, "node_modules/.bin/tsx"),
      ["src/index.ts"],
      {
        cwd: IDENTITY_DIR,
        env: {
          ...process.env,
          PORT: String(identityPort),
          BIND_HOST: "127.0.0.1",
          DATABASE_URL: `postgres://identity_svc:identity_dev_pw@${PG_HOST_PORT}/civitas_identity`,
          DB_URL: `postgres://identity_svc:identity_dev_pw@${PG_HOST_PORT}/civitas_identity`,
          IDENTITY_SCANNER_DATABASE_URL: `postgres://identity_scanner:identity_scanner_dev_pw@${PG_HOST_PORT}/civitas_identity`,
          QUEUE_DRIVER: "memory",
          CACHE_DRIVER: "memory",
          JWT_ALGORITHM: "HS256",
          JWT_SECRET: "test_secret_for_civitasone_32chr",
          MFA_ENC_KEY: "test-mfa-encryption-key-at-least-16",
          SCIM_BEARER_TOKEN: "test-scim-bearer-token-for-coverage",
          SCIM_TENANT_ID: "aaaaaaaa-1111-4000-8000-000000000099",
          // The one value that matters most for this test: gateway's
          // apiKeyPreHandler and this real identity-service child MUST agree
          // on the same secret for assertGatewayRequest to accept the call.
          INTERNAL_SERVICE_SECRET: SHARED_INTERNAL_SECRET,
          LOG_LEVEL: "warn",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let startupLog = "";
    identityProc.stdout?.on("data", (d) => { startupLog += String(d); });
    identityProc.stderr?.on("data", (d) => { startupLog += String(d); });
    identityProc.on("exit", (code, signal) => {
      if (code !== null && code !== 0) {
        // eslint-disable-next-line no-console
        console.error(`identity-service subprocess exited early (code=${code}, signal=${signal}):\n${startupLog}`);
      }
    });

    await waitUntilReady(`http://127.0.0.1:${identityPort}/health`);

    // Seed real api_keys rows directly against the disposable Postgres, as
    // the actual Postgres superuser (bypasses RLS for setup only -- the code
    // path under test, verifyApiKey, still runs as identity_svc/
    // identity_scanner under normal RLS enforcement). Mirrors the raw-key
    // format apikeys/domain.ts#generateSecret produces (prefix.secret) so
    // hashing/lookup behaves identically to a real issued key.
    seedSql = createSqlClient(`postgres://civitas:civitas_test@${PG_HOST_PORT}/civitas_identity`);

    validKeyId = randomUUID();
    const validSecret = `ak_test_${randomUUID()}.${randomUUID()}`;
    validKey = validSecret;
    // key_prefix carries a uq_api_keys_prefix unique constraint -- each seeded
    // row needs its own distinct prefix, not just a distinct secret/hash.
    await seedSql`
      INSERT INTO apikeys.api_keys
        (id, tenant_id, name, key_prefix, secret_hash, scopes, status, created_by, updated_by)
      VALUES
        (${validKeyId}, ${TEST_TENANT}, ${"sec-024 real-http test key"}, ${`ak_test_${validKeyId.slice(0, 8)}`},
         ${sha256Hex(validSecret)}, ${JSON.stringify(["finance:read"])}::jsonb, 'active',
         ${TEST_ACTOR}, ${TEST_ACTOR})
    `;

    const inactiveId = randomUUID();
    const inactiveSecret = `ak_test_${randomUUID()}.${randomUUID()}`;
    inactiveKey = inactiveSecret;
    await seedSql`
      INSERT INTO apikeys.api_keys
        (id, tenant_id, name, key_prefix, secret_hash, scopes, status, created_by, updated_by)
      VALUES
        (${inactiveId}, ${TEST_TENANT}, ${"sec-024 revoked test key"}, ${`ak_test_${inactiveId.slice(0, 8)}`},
         ${sha256Hex(inactiveSecret)}, ${JSON.stringify(["finance:read"])}::jsonb, 'revoked',
         ${TEST_ACTOR}, ${TEST_ACTOR})
    `;

    // Point the real, unmodified apiKeyPreHandler at the real child process.
    process.env.IDENTITY_SERVICE_URL = `http://127.0.0.1:${identityPort}`;
    process.env.INTERNAL_SERVICE_SECRET = SHARED_INTERNAL_SECRET;

    // Minimal real Fastify app wrapping the actual, unmodified apiKeyPreHandler
    // as a preHandler -- app.inject() drives the OUTER request in-process
    // (standard, house-wide test style), but resolveKeyRecord's own fetch()
    // inside apiKeyPreHandler genuinely crosses the network to the identity-
    // service child process. That inner call is the one SEC-024 is about.
    const { apiKeyPreHandler } = await import("../src/api-key-auth.js");
    testApp = Fastify();
    const echoHandler = async (req: FastifyRequest) => ({
      apiKeyAuthenticated: (req as unknown as { apiKeyAuthenticated?: boolean }).apiKeyAuthenticated ?? false,
      tenantId: req.headers["x-tenant-id"] ?? null,
      actorId: req.headers["x-actor-id"] ?? null,
      authMethod: req.headers["x-auth-method"] ?? null,
    });
    // GET → derives scope finance:read (matches validKey's own scope);
    // POST → derives finance:write, used by the scope-denial test below
    // (validKey only ever carries finance:read).
    testApp.get("/v1/finance/bills", { preHandler: apiKeyPreHandler }, echoHandler);
    testApp.post("/v1/finance/bills", { preHandler: apiKeyPreHandler }, echoHandler);
  }, 45_000);

  afterAll(async () => {
    await testApp?.close();
    await seedSql?.end({ timeout: 5 });
    if (identityProc && !identityProc.killed) {
      identityProc.kill("SIGTERM");
      await new Promise((resolve) => {
        const t = setTimeout(() => { identityProc.kill("SIGKILL"); resolve(undefined); }, 5_000);
        identityProc.once("exit", () => { clearTimeout(t); resolve(undefined); });
      });
    }
  }, 15_000);

  it("a valid, active, in-scope key reaches identity-service for real and authenticates", async () => {
    const res = await testApp.inject({
      method: "GET",
      url: "/v1/finance/bills",
      headers: { "x-api-key": validKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.apiKeyAuthenticated).toBe(true);
    expect(body.tenantId).toBe(TEST_TENANT);
    expect(body.actorId).toBe(TEST_ACTOR);
    expect(body.authMethod).toBe("api-key");
  });

  it("an unknown key is rejected 401 (verify call succeeds, key genuinely invalid)", async () => {
    const res = await testApp.inject({
      method: "GET",
      url: "/v1/finance/bills",
      headers: { "x-api-key": `ak_test_${randomUUID()}.${randomUUID()}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("INVALID_API_KEY");
  });

  it("a revoked key is rejected 401 — identity-service's own active/expiry check, honored end to end", async () => {
    const res = await testApp.inject({
      method: "GET",
      url: "/v1/finance/bills",
      headers: { "x-api-key": inactiveKey },
    });
    expect(res.statusCode).toBe(401);
  });

  it("a valid key without the required scope is rejected 403, not silently let through", async () => {
    // validKey only carries finance:read; POST derives finance:write.
    const res = await testApp.inject({
      method: "POST",
      url: "/v1/finance/bills",
      headers: { "x-api-key": validKey },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("SCOPE_DENIED");
  });

  it("no x-api-key header → preHandler no-ops, falls through untouched", async () => {
    const res = await testApp.inject({ method: "GET", url: "/v1/finance/bills" });
    expect(res.statusCode).toBe(200);
    expect(res.json().apiKeyAuthenticated).toBe(false);
  });
});
