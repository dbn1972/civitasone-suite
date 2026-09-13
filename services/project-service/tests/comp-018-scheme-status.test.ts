/**
 * project-service — scheme status mapping regression test (COMP-018).
 *
 * scheme.project_schemes.status's DB CHECK constraint (0001_init.sql, reasserted
 * as a named constraint by 0010_check_constraints_status_columns.sql) only ever
 * allows 'active' | 'completed' | 'cancelled'. Until this fix, queries.ts's
 * listSchemeSummaries() and getSchemeDetail() both mapped status through a
 * ternary that checked for a literal "discontinued" value -- a string the DB
 * schema has never allowed and no row can ever hold -- so a genuinely
 * 'cancelled' row matched neither of the ternary's two non-active branches and
 * silently fell through to "active". SchemeSummarySchema/SchemeDetailSchema
 * (packages/schemas/src/web.ts) and SchemeSummary/SchemeDetail
 * (packages/types/src/index.ts) all typed status the same wrong way.
 *
 * This suite proves, end to end against a real Postgres (rows inserted
 * directly via Drizzle -- there is no create/update command that can set
 * status today, so a direct DB write is the only realistic way a row reaches
 * this state; same pattern this suite's sibling comp-016 test
 * (comp-016-columns-scheme-fields.test.ts) already uses for its own DB-layer
 * constraint checks) that a 'cancelled' scheme now reports status "cancelled",
 * not "active", on both the real GET /v1/projects/schemes (list) and
 * GET /v1/projects/schemes/:id (detail) routes -- 'active' and 'completed'
 * rows are asserted alongside it so the fix is proven not to have broken the
 * two cases that already worked.
 *
 * Sabotage-checked: reverting queries.ts's two status ternaries back to their
 * pre-fix `row.status === "discontinued" ? "discontinued" : "active"` branch
 * reproduces the bug exactly -- both cancelled-row assertions below fail
 * (list and detail both report "active") while the active/completed
 * assertions keep passing, confirming this test actually exercises the fix
 * rather than passing vacuously. Restored afterwards; all assertions pass.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { cache } from "../src/shared/infra.js";
import { projectSchemes } from "../src/modules/scheme/schema.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "c018c000-dead-4000-8000-0000000c018c";
const ACTOR  = "c018c000-dead-4000-8000-0000000ac70c";

function authHeader(roles: string[] = ["project_manager"]) {
  const jwt = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-comp-018-status" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

async function clean() {
  // Wrapped in runWithTenant + db.transaction so wrapWithTenantGuc injects
  // app.tenant_id before this write -- a bare db.delete() runs with no RLS
  // GUC set and is silently rejected under FORCE RLS. Same pattern as
  // comp-016-columns-scheme-fields.test.ts's own clean().
  await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.delete(projectSchemes).where(eq(projectSchemes.tenantId, TENANT))));
  // Defensive: TENANT is unique to this file, so there is no realistic
  // pre-existing cache entry today -- but listSchemeSummaries() caches its
  // result per (tenantId, limit) for up to 60s (packages/cache defaultTtl),
  // and a stale list cache surviving into a later run in the same
  // long-lived process (e.g. vitest --watch) would silently mask the exact
  // regression this file exists to catch. Cheap enough to always run.
  await cache.invalidateResource(TENANT, "schemes");
}

let app: FastifyInstance;
let activeId: string;
let completedId: string;
let cancelledId: string;

beforeAll(async () => {
  app = await buildApp();
  await clean();

  activeId = randomUUID();
  completedId = randomUUID();
  cancelledId = randomUUID();

  // Direct DB insert, not the schemeCreate command: no command/consumer in
  // this module can set status away from its "active" default today, so a
  // genuinely 'cancelled' (or 'completed') row can currently only arise from
  // a direct write -- exactly the scenario COMP-018 is about.
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(projectSchemes).values({
      id: activeId, tenantId: TENANT, code: "COMP018-ACTIVE", name: "COMP-018 Active Scheme",
      status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(projectSchemes).values({
      id: completedId, tenantId: TENANT, code: "COMP018-COMPLETED", name: "COMP-018 Completed Scheme",
      status: "completed", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(projectSchemes).values({
      id: cancelledId, tenantId: TENANT, code: "COMP018-CANCELLED", name: "COMP-018 Cancelled Scheme",
      status: "cancelled", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
});

afterAll(async () => {
  await clean();
  await app.close();
});

describe("scheme status mapping (COMP-018)", () => {
  it("GET /v1/projects/schemes (list): a cancelled scheme reports status 'cancelled', not 'active'", async () => {
    // SchemeSummaryListSchema is z.array(SchemeSummarySchema) -- sendValidated
    // sends schema.parse(data) directly, so the real response body is a bare
    // JSON array, not a {data, meta} envelope.
    const res = await app.inject({ method: "GET", url: "/v1/projects/schemes?limit=500", headers: authHeader() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; status: string }>;
    const byId = new Map(body.map((r) => [r.id, r.status]));

    expect(byId.get(cancelledId)).toBe("cancelled");
    // Not the pre-fix bug's silent fallback:
    expect(byId.get(cancelledId)).not.toBe("active");
    expect(byId.get(activeId)).toBe("active");
    expect(byId.get(completedId)).toBe("completed");
  });

  it("GET /v1/projects/schemes/:id (detail): a cancelled scheme reports status 'cancelled', not 'active'", async () => {
    const cancelledRes = await app.inject({ method: "GET", url: `/v1/projects/schemes/${cancelledId}`, headers: authHeader() });
    expect(cancelledRes.statusCode).toBe(200);
    expect(cancelledRes.json().status).toBe("cancelled");
    expect(cancelledRes.json().status).not.toBe("active");

    const activeRes = await app.inject({ method: "GET", url: `/v1/projects/schemes/${activeId}`, headers: authHeader() });
    expect(activeRes.json().status).toBe("active");

    const completedRes = await app.inject({ method: "GET", url: `/v1/projects/schemes/${completedId}`, headers: authHeader() });
    expect(completedRes.json().status).toBe("completed");
  });
});
