/**
 * migrate-all inventory regression lock.
 *
 * Every services/*-service with migrations/*.sql must appear in
 * scripts/dev/migrate-all.mjs SERVICES (or be documented below).
 *
 * CI: Architecture Guard job (.github/workflows/ci.yml arch-guard)
 *     runs: pnpm exec vitest run tests/ops/migrate-all-inventory.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");
const MIGRATE_ALL = join(ROOT, "scripts/dev/migrate-all.mjs");
const SERVICES_DIR = join(ROOT, "services");

/**
 * Services with SQL migrations intentionally omitted from migrate-all.
 * gateway-service: edge proxy; api-catalogue migrations applied separately.
 * queue-service: no migrations/ directory — internal control plane, no DB schema.
 */
const MIGRATE_ALL_EXCEPTIONS: Record<string, string> = {
  "gateway-service":
    "edge proxy — api-catalogue migrations applied outside migrate-all fleet loop",
  "queue-service": "no migrations/ directory — internal control plane, no DB schema",
};

function parseMigrateAllServices(): Set<string> {
  const src = readFileSync(MIGRATE_ALL, "utf8");
  return new Set([...src.matchAll(/\{\s*name:\s*"([^"]+)"/g)].map((m) => m[1]!));
}

function servicesWithSqlMigrations(): string[] {
  return readdirSync(SERVICES_DIR)
    .filter((d) => d.endsWith("-service"))
    .filter((d) => {
      const migDir = join(SERVICES_DIR, d, "migrations");
      if (!existsSync(migDir)) return false;
      return readdirSync(migDir).some((f) => f.endsWith(".sql"));
    })
    .sort();
}

describe("migrate-all inventory", () => {
  const listed = parseMigrateAllServices();
  const withMigrations = servicesWithSqlMigrations();

  it("includes visitor-service and works-service", () => {
    expect(listed.has("visitor-service")).toBe(true);
    expect(listed.has("works-service")).toBe(true);
  });

  it("lists every *-service with migrations/*.sql (except documented exceptions)", () => {
    const missing = withMigrations.filter(
      (svc) => !listed.has(svc) && MIGRATE_ALL_EXCEPTIONS[svc] === undefined,
    );
    expect(
      missing,
      `Add to scripts/dev/migrate-all.mjs or document in MIGRATE_ALL_EXCEPTIONS:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("documents all known exceptions with a reason", () => {
    for (const [svc, reason] of Object.entries(MIGRATE_ALL_EXCEPTIONS)) {
      expect(reason.length, `${svc} exception needs a reason`).toBeGreaterThan(0);
    }
  });
});

/**
 * GAP2-LOCATIONS-MIGRATE-01: one non-idempotent migration failure must not
 * strand the service's LATER migrations (RLS retrofits, tenant indexes). The
 * old runner `break`ed out of the per-service loop on the first hard error, so
 * every file after the failed one was silently skipped. The fix continues the
 * chain (still exiting non-zero at the end). This asserts the error branch of
 * the per-service migration loop does not `break` — it fails on the old code.
 */
describe("migrate-all does not strand later migrations after a single failure", () => {
  const src = readFileSync(MIGRATE_ALL, "utf8");

  it("the per-migration error branch continues instead of breaking out of the service loop", () => {
    // Isolate the per-service `for (const file of files)` loop body.
    const loopStart = src.indexOf("for (const file of files)");
    expect(loopStart, "could not find the per-migration loop").toBeGreaterThan(-1);
    const loopBody = src.slice(loopStart, src.indexOf("── Migration summary"));

    // The hard-error branch must NOT abort the remaining chain.
    expect(
      /\bbreak\s*;/.test(loopBody),
      "migrate-all per-migration loop must not `break` on a single failure — that strands later RLS/perf migrations (GAP2-LOCATIONS-MIGRATE-01)",
    ).toBe(false);
    expect(
      /\bcontinue\s*;/.test(loopBody),
      "migrate-all should `continue` past a failed migration so later migrations still apply",
    ).toBe(true);
  });

  it("still fails the whole run loudly (non-zero exit) when any migration errors", () => {
    expect(src).toMatch(/if \(errors > 0\) process\.exit\(1\)/);
  });
});
