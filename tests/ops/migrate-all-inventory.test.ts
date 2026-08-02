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
