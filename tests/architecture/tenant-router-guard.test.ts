/**
 * tenant-router-guard.mjs — fixture-based unit tests (Req 1.7).
 *
 * Exercises the exported `checkFile()` function directly with in-memory
 * `shared/db.ts` source strings (compliant `createTenantDb` usage, the
 * hand-rolled estab-service-style `TenantRouter` pattern, and a direct
 * `createSqlClient` violation) rather than requiring real fixture files on
 * disk, mirroring the pure "exported functions + optional CLI entrypoint"
 * shape used by scripts/ops/lib/outcome-aggregation.mjs.
 *
 * Run: pnpm exec vitest run tests/architecture/tenant-router-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import { checkFile } from "../../scripts/ci/tenant-router-guard.mjs";

describe("tenant-router-guard: checkFile()", () => {
  it("reports a compliant shared/db.ts using createTenantDb as clean (no violations)", () => {
    const source = `
import { createTenantDb } from "@civitasone/db";
import { schema as budgetModule } from "../modules/budget/schema.js";
import { outboxSchema } from "./outbox.js";

const SCHEMA = {
  ...budgetModule,
  ...outboxSchema,
};

const { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead } = createTenantDb({ schema: SCHEMA });

export { sqlClient, db, dbFor, sqlClientFor, tierOf, dbForRead };
export type Db = typeof db;
`;

    expect(checkFile(source)).toEqual([]);
  });

  it("reports the estab-service-style TenantRouter pattern (new TenantRouter + imported TenantRouter) as clean", () => {
    const source = `
import { drizzle } from "drizzle-orm/postgres-js";
import { createSqlClient, TenantRouter, envTenantResolver, cachedResolver } from "@civitasone/db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

export const sqlClient = createSqlClient(url);

const router = new TenantRouter({
  poolDsn: url,
  resolver: cachedResolver(envTenantResolver()),
  clientFactory: (dsn, opts) => (dsn === url ? sqlClient : createSqlClient(dsn, opts)),
});

export async function sqlClientFor(tenantId: string) {
  return router.sqlFor(tenantId);
}
`;

    expect(checkFile(source)).toEqual([]);
  });

  it("reports a direct createSqlClient violation with the correct line and snippet", () => {
    const source = `import { createSqlClient } from "@civitasone/db";
import { schema as widgetModule } from "../modules/widget/schema.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

export const sqlClient = createSqlClient(url);
`;

    const violations = checkFile(source);

    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(7);
    expect(violations[0].snippet).toContain("createSqlClient(url)");
  });

  it("does not flag a createSqlClient call that is guarded by an in-file createTenantDb call", () => {
    // Defensive case: even if a file also happens to call createSqlClient
    // directly (e.g. a transitional/manual pattern), the guard's compliance
    // check is a whole-file OR — createTenantDb() anywhere in the file marks
    // it compliant, matching packages/db's own internal implementation files
    // being excluded by the guard's file-discovery scope (not by this rule).
    const source = `
import { createSqlClient, createTenantDb } from "@civitasone/db";

const url = process.env.DATABASE_URL!;
export const legacyClient = createSqlClient(url);

const { db, sqlClient } = createTenantDb({ schema: {} });
export { db, sqlClient };
`;

    expect(checkFile(source)).toEqual([]);
  });

  it("does not flag createSqlClient mentioned only in a comment", () => {
    const source = `
// TODO: migrate away from createSqlClient(url) once createTenantDb lands.
import { createTenantDb } from "@civitasone/db";
const { db, sqlClient } = createTenantDb({ schema: {} });
export { db, sqlClient };
`;

    expect(checkFile(source)).toEqual([]);
  });
});
