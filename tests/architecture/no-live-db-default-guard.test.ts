/**
 * no-live-db-default-guard.mjs: fixture tests plus the real-tree scan (FQ15).
 *
 * Fixture strings build the live ports by concatenation so this file never
 * contains the literal patterns the guard scans for.
 *
 * Run: pnpm exec vitest run tests/architecture/no-live-db-default-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  findLiveDbDefaults,
  isInScope,
  scanRepo,
} from "../../scripts/ci/no-live-db-default-guard.mjs";
import {
  TEST_DB_NOT_CONFIGURED,
  hasTestDb,
  requireTestDb,
  testDbHostPort,
} from "../../vitest.testdb";

const PG = "54" + "35";
const BOUNCER = "64" + "32";

describe("findLiveDbDefaults(): flags live-DB defaults", () => {
  it("flags a loopback DSN fallback (the REL-035 / hrms shape)", () => {
    const src = `const url = process.env.DATABASE_URL ?? "postgres://hrms_svc:pw@localhost:${PG}/civitas_hrms";`;
    expect(findLiveDbDefaults(src)).toHaveLength(1);
  });

  it("flags a PGPORT fallback (the inventory data-quality shape)", () => {
    const src = `const PORT = Number(process.env.PGPORT ?? "${PG}");`;
    expect(findLiveDbDefaults(src)[0]?.rule).toBe("fallback-live-port");
  });

  it("flags the pgbouncer port and || / numeric fallbacks", () => {
    expect(findLiveDbDefaults(`const p = process.env.PORT || ${BOUNCER};`)).toHaveLength(1);
    expect(findLiveDbDefaults(`const u = "postgres://a@127.0.0.1:${BOUNCER}/x";`)).toHaveLength(1);
  });

  it("flags a vitest.config env injection (the inventory vitest.config shape)", () => {
    const src = `      PGPORT: process.env.PGPORT ?? "${PG}",`;
    expect(findLiveDbDefaults(src)).toHaveLength(1);
  });
});

describe("findLiveDbDefaults(): widened patterns (review of #2387)", () => {
  it("flags a connection-object port, same line or multi-line", () => {
    expect(findLiveDbDefaults(`const c = { host: HOST, port: ${PG}, user: "u" };`)[0]?.rule).toBe(
      "connection-object-live-port",
    );
    const multi = ["const conn = {", "  host: process.env.PGHOST,", `  port: "${BOUNCER}",`, "};"].join("\n");
    expect(findLiveDbDefaults(multi).map((v) => v.line)).toEqual([3]);
  });

  it("flags a template-literal host joined to a live port", () => {
    const src = "const dsn = `postgres://u:p@${host}:" + PG + "/db`;";
    expect(findLiveDbDefaults(src)[0]?.rule).toBe("template-host-live-port");
  });

  it("flags a port constant, quoted or numeric", () => {
    expect(findLiveDbDefaults(`const PORT = ${PG};`)[0]?.rule).toBe("constant-live-port");
    expect(findLiveDbDefaults(`let pgPort: string = "${BOUNCER}";`)[0]?.rule).toBe("constant-live-port");
  });

  it("leaves a display-only mock port and a refusal constant alone", () => {
    const mock = [
      `  database: { host: "db-host", port: 5432 },`,
      `  redis: { url: "redis://r:6379" },`,
      `  auth: { provider: "Keycloak" },`,
      `  pgbouncer: { configured: true, port: ${BOUNCER}, poolMode: "transaction" },`,
    ].join("\n");
    expect(findLiveDbDefaults(mock)).toEqual([]);
    expect(findLiveDbDefaults(`const SHARED_INSTANCE_PORT = "${PG}";`)).toEqual([]);
  });
});

describe("findLiveDbDefaults(): leaves legitimate uses alone", () => {
  it("ignores comment lines", () => {
    const src = [
      `// CI runs Postgres on localhost:${PG}`,
      ` *   DATABASE_URL=postgres://u:p@localhost:${PG}/db \\`,
      `/* PGPORT ?? "${PG}" used to be here */`,
    ].join("\n");
    expect(findLiveDbDefaults(src)).toEqual([]);
  });

  it("ignores non-default literals: helm assertions, refusal constants, non-loopback DSNs", () => {
    const src = [
      `expect(body).toMatch(/containerPort:\\s*${BOUNCER}/);`,
      `const SHARED_INSTANCE_PORT = "${PG}";`,
      `if (port === "${PG}" && !inCi) throw new Error("refusing");`,
      `const url = "postgres://svc:pw@pgbouncer:${BOUNCER}/civitas_finance";`,
      "const url = `postgres://u:p@${testDbHostPort()}/civitas_hrms`;",
    ].join("\n");
    expect(findLiveDbDefaults(src)).toEqual([]);
  });

  it("does not match a longer port that merely starts with a live one", () => {
    expect(findLiveDbDefaults(`const u = "postgres://a@localhost:${PG}9/x";`)).toEqual([]);
  });
});

describe("isInScope()", () => {
  it("covers tests, test files, vitest configs and the root vitest helpers", () => {
    expect(isInScope("services/inventory-service/tests/data-quality.test.ts")).toBe(true);
    expect(isInScope("services/inventory-service/vitest.config.ts")).toBe(true);
    expect(isInScope("services/hrms-service/tests/fixtures/core-seed.ts")).toBe(true);
    expect(isInScope("packages/db/src/jsonb-encoding.test.ts")).toBe(true);
    expect(isInScope("tests/cross-service-live/harness.ts")).toBe(true);
    expect(isInScope("vitest.config.mjs")).toBe(true);
    expect(isInScope("vitest.testdb.ts")).toBe(true);
  });

  it("covers service-level setup files and named vitest configs", () => {
    expect(isInScope("apps/web/vitest.setup.ts")).toBe(true);
    expect(isInScope("packages/ocr/vitest.cer.config.ts")).toBe(true);
    expect(isInScope("vitest.mutation.config.ts")).toBe(true);
    expect(isInScope("services/location-service/tests/setup.ts")).toBe(true);
    expect(isInScope("apps/web/e2e/global-setup.ts")).toBe(true);
    expect(isInScope("apps/web/src/app/(app)/setup/setupSkipApi.ts")).toBe(false);
  });

  it("explicitly allows CI workflow YAML only, and skips non-test source", () => {
    expect(isInScope(".github/workflows/ci.yml")).toBe(false);
    expect(isInScope("services/inventory-service/src/index.ts")).toBe(false);
    expect(isInScope("node_modules/x/tests/a.test.ts")).toBe(false);
  });
});

describe("vitest.testdb helpers", () => {
  it("throws the clear 'not configured' error instead of defaulting", () => {
    expect(() => requireTestDb({})).toThrow(TEST_DB_NOT_CONFIGURED);
    expect(() => testDbHostPort({ PGHOST: "127.0.0.1" })).toThrow(/refusing to default to a live database/);
    expect(hasTestDb({ PGPORT: "55001" })).toBe(false);
  });

  it("uses exactly what the env gives (CI: PGHOST=localhost PGPORT=5435)", () => {
    expect(testDbHostPort({ PGHOST: "localhost", PGPORT: PG })).toBe(`localhost:${PG}`);
    expect(requireTestDb({ PGHOST: "127.0.0.1", PGPORT: "55001" })).toEqual({ host: "127.0.0.1", port: "55001" });
  });
});

describe("real tree", () => {
  it("no test, test setup or test config defaults to a live database", () => {
    const { scanned, violations } = scanRepo();
    expect(scanned).toBeGreaterThan(1000);
    expect(violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.text}`)).toEqual([]);
  });
});
