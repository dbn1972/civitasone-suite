/**
 * project-service — schemes LIST endpoint real-DB regression test.
 *
 * THE REPORTED BUG: GET /v1/projects/schemes (the Schemes list page) 500'd
 * in production: {"code":"UPSTREAM_ERROR","message":"Upstream service
 * \"project\" returned 500"}. Root cause: scheme.project_schemes had no
 * nodal_officer column. repo.listSchemesByTenant() (called by
 * queries.listSchemeSummaries(), called by this route) does a bare
 * `tx.select().from(projectSchemes)` -- Drizzle expands a column-less
 * select() into an explicit column list built from EVERY field declared on
 * the projectSchemes table object in schema.ts, which has included
 * nodalOfficer/department/beneficiaries/startDate/endDate since migration
 * 0021_scheme_detail_fields.sql was authored (PR #1246). The SELECT fails
 * at the SQL layer -- "column nodal_officer does not exist" -- before
 * listSchemeSummaries()'s row-mapping ever runs, even though that mapping
 * never reads any of the 5 new fields (only getSchemeDetail(), backing the
 * separate GET .../:id route, surfaces them in its DTO). That is why this
 * needed its own test: comp-016-columns-scheme-fields.test.ts already
 * covers the detail route and migration 0021's CHECK constraints
 * exhaustively, and comp-018-scheme-status.test.ts's list-route test
 * happens to insert real rows too, but neither is *purpose-built* to prove
 * the list route itself -- the one this bug was actually reported against
 * -- returns 200 rather than 500 once the column exists. No repo.ts- or
 * queries.ts-mocked test (e.g. project/queries.test.ts's own pattern) can
 * catch this class of bug at all: the failure lives in the real generated
 * SQL, never in any JS-side logic a mock would stand in for.
 *
 * Independently verified 2026-09-23: migration 0021 itself is correct and
 * idempotent (ADD COLUMN IF NOT EXISTS; the two-column dates CHECK is added
 * inside a `DO $$ ... EXCEPTION WHEN duplicate_object` block) -- run from
 * scratch via scripts/ci/bootstrap-postgres.sh it applies cleanly every
 * time (re-verified against a fresh disposable Postgres while diagnosing
 * this bug). It landed in PR #1246 (2026-09-13) but was never applied to
 * the live database: scripts/deployment-runbook.md's Deploy section (git
 * pull -> pnpm build -> pm2 restart all -> pm2 start ecosystem.config.js ->
 * pm2 save) never runs a migration step at all -- migrate-all.mjs /
 * bootstrap-postgres.sh only run in CI (.github/workflows/ci.yml),
 * install.sh, and scripts/dev/verify-live-stack.sh. CI's Postgres is always
 * bootstrapped fresh from migration 0001 forward, so this suite (like
 * comp-016's and comp-018's) would have passed in CI the whole time
 * regardless of the live DB's actual migration state -- this was a
 * deploy-process gap, not a test-coverage gap. See this change's PR
 * description for the full writeup and the deploy instructions for closing
 * it on the live DB.
 *
 * Sabotage-checked (no code change made -- see PR description): pointing
 * this suite at a database with migration 0021 not applied (dropping the 5
 * columns via the exact rollback 0021's own header comment documents)
 * reproduces the bug exactly -- this suite's beforeAll guard fails fast
 * with an actionable message instead of the list request 500ing with a raw
 * `column "nodal_officer" does not exist`. Re-applying 0021 restores a
 * clean pass with no other changes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { projectSchemes } from "../src/modules/scheme/schema.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "c016c000-1157-4000-8000-0000000c1157";
const ACTOR = "c016c000-1157-4000-8000-0000000ac70c";

function authHeader(roles: string[] = ["project_manager"]) {
  const jwt = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-comp-016-list-500" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

async function clean() {
  // Wrapped in runWithTenant + db.transaction() so wrapWithTenantGuc injects
  // app.tenant_id before this write -- a bare db.delete() runs with no RLS
  // GUC set and is silently rejected under FORCE RLS. Same pattern as
  // comp-016-columns-scheme-fields.test.ts / comp-018-scheme-status.test.ts.
  await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.delete(projectSchemes).where(eq(projectSchemes.tenantId, TENANT))),
  );
}

let app: FastifyInstance;
let schemeId: string;

beforeAll(async () => {
  // Fail fast with an actionable message if this environment's migration
  // was never applied, instead of the test below drowning in a raw
  // "column does not exist" 500 with no pointer to the fix.
  const [row] = await sqlClient<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'scheme' AND table_name = 'project_schemes'
        AND column_name = 'nodal_officer'
    ) AS present
  `;
  if (!row?.present) {
    throw new Error(
      "scheme.project_schemes.nodal_officer does not exist in this database " +
        `(DATABASE_URL=${process.env.DATABASE_URL ?? "<default from vitest.config.ts>"}). ` +
        "Apply services/project-service/migrations/0021_scheme_detail_fields.sql " +
        "(scripts/ci/bootstrap-postgres.sh or scripts/dev/migrate-all.mjs) before running this suite.",
    );
  }

  app = await buildApp();
  await clean();

  schemeId = randomUUID();
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.insert(projectSchemes).values({
        id: schemeId,
        tenantId: TENANT,
        code: "COMP016-LIST500",
        name: "List Endpoint Regression Scheme",
        totalOutlayMinor: 500000n,
        releasedMinor: 200000n,
        nodalOfficer: "Shri Test Officer",
        department: "Rural Development",
        beneficiaries: 250,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    ),
  );
});

afterAll(async () => {
  await clean();
  // beforeAll's fail-fast guard throws before `app` is assigned when the
  // migration is missing -- guard the close so that real failure surfaces
  // cleanly instead of being masked by a secondary "Cannot read properties
  // of undefined (reading 'close')" here.
  if (app) await app.close();
});

describe("GET /v1/projects/schemes (list) -- the endpoint this bug was reported against", () => {
  it("200, not the UPSTREAM_ERROR 500 this bug reported -- bare select() pulls nodal_officer/department/beneficiaries/start_date/end_date into the generated SQL even though the list DTO never reads them", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/projects/schemes?limit=500", headers: authHeader() });

    expect(res.statusCode).toBe(200);
    // SchemeSummaryListSchema is z.array(SchemeSummarySchema) -- sendValidated
    // sends schema.parse(data) directly: the real response body is a bare
    // JSON array, not a {data, meta} envelope. Same convention
    // comp-018-scheme-status.test.ts already documents for this same route.
    const body = res.json() as Array<{ id: string; schemeCode: string; name: string }>;
    const row = body.find((r) => r.id === schemeId);
    expect(row).toBeTruthy();
    expect(row?.schemeCode).toBe("COMP016-LIST500");
    expect(row?.name).toBe("List Endpoint Regression Scheme");
  });
});
