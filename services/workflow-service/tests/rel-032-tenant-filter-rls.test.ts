/**
 * REL-032 -- independent verification that RLS is a genuine backstop for
 * castVoteTx's internal queries, not just an assumed one.
 *
 * docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's REL-032 row noted the missing
 * tenantId filter "reads as a defense-in-depth gap rather than a live
 * cross-tenant read today ... not yet independently re-verified against a
 * real RLS-enabled cluster." This file does that re-verification directly:
 * it runs the BARE, unscoped-by-tenantId query shape castVoteTx's
 * recompute-tally query used to run (`SELECT ... FROM committee_votes WHERE
 * decision_id = $1`, no tenant_id predicate at all) as the real
 * `workflow_svc` login role -- the same role the service actually connects
 * as in production, never a superuser -- with no `app.tenant_id` GUC set,
 * then with a DIFFERENT real tenant's GUC, then with the correct tenant's
 * GUC. Connects with a raw `postgres` client rather than the app's `db`
 * (which auto-injects the GUC via wrapWithTenantGuc) specifically so this
 * test controls the GUC by hand, one state at a time.
 *
 * This is orthogonal to rel-032-cast-vote-tenant-filter.test.ts, which
 * proves castVoteTx's OWN query text now filters on tenantId too (that file
 * deliberately bypasses RLS with a superuser connection so RLS can't mask a
 * reintroduced gap -- see its header for why). This file instead proves the
 * OTHER half of the story: that even before the fix, RLS itself was
 * independently already closing the hole for any normal, non-superuser,
 * NOBYPASSRLS connection -- i.e. the gap really was "defense-in-depth", not
 * a live production leak, matching the gap-report's own hypothesis but now
 * empirically confirmed rather than assumed.
 *
 * Skips (does not fail) when Postgres is unreachable so a machine without
 * the dev database still gets a green suite -- same convention as
 * services/catalogue-service/tests/integration/catalogue-locking.int.test.ts.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const EXPECTED_DB = "civitas_workflow";
const DEFAULT_DSN = `postgres://workflow_svc:workflow_dev_pw@localhost:5435/${EXPECTED_DB}`;
// Only honour an inherited DSN when it actually addresses this service's
// database -- a vitest config further up the tree can otherwise point
// DATABASE_URL at a different service's DB.
const inheritedDsn = process.env["DATABASE_URL"];
const DSN = inheritedDsn?.includes(EXPECTED_DB) === true ? inheritedDsn : DEFAULT_DSN;

/** Cheap connectivity probe on a throwaway client, used only to decide skip vs run. */
async function probe(): Promise<boolean> {
  const client = postgres(DSN, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
  try {
    await client`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.end({ timeout: 1 }).catch(() => undefined);
  }
}

const reachable = await probe();

describe.skipIf(!reachable)(
  "REL-032 -- RLS is an independently-verified backstop for the unscoped query shape (real workflow_svc connection, no mocks)",
  () => {
    // max: 1 -- every query in this file must land on the SAME physical
    // connection, because set_config(..., false) (session-level, not
    // per-transaction) is how this test drives the GUC through its three
    // states in sequence; a pooled connection could otherwise serve a later
    // query from a session that never had the GUC change applied.
    const sql = postgres(DSN, { max: 1, onnotice: () => {} });
    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const DECISION_ID = randomUUID();
    const VOTER_ID = randomUUID();
    const ACTOR_ID = randomUUID();

    afterAll(async () => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`;
      await sql`DELETE FROM workflow.committee_votes WHERE decision_id = ${DECISION_ID}`;
      await sql`DELETE FROM workflow.committee_decisions WHERE id = ${DECISION_ID}`;
      await sql.end({ timeout: 1 }).catch(() => undefined);
    });

    it("seeds a real decision + vote for TENANT_A (correct GUC required to pass RLS's WITH CHECK)", async () => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`;
      await sql`
        INSERT INTO workflow.committee_decisions (id, tenant_id, subject, rule, total_members, status, created_by)
        VALUES (${DECISION_ID}, ${TENANT_A}, 'REL-032 RLS backstop proof', 'majority', 5, 'open', ${ACTOR_ID})
      `;
      await sql`
        INSERT INTO workflow.committee_votes (tenant_id, decision_id, voter_id, vote)
        VALUES (${TENANT_A}, ${DECISION_ID}, ${VOTER_ID}, 'approve')
      `;
      const seeded = await sql`SELECT count(*)::int AS n FROM workflow.committee_votes WHERE decision_id = ${DECISION_ID}`;
      expect(seeded[0]?.["n"]).toBe(1);
    });

    it("bare unscoped-by-tenant query, NO app.tenant_id GUC set at all -- returns ZERO rows (fails closed)", async () => {
      await sql`SELECT set_config('app.tenant_id', '', false)`;
      const guc = await sql`SELECT current_setting('app.tenant_id', true) AS v`;
      expect(guc[0]?.["v"]).toBeFalsy();
      // The exact shape castVoteTx's recompute-tally query used to run
      // pre-fix: no tenant_id predicate at all.
      const rows = await sql`SELECT * FROM workflow.committee_votes WHERE decision_id = ${DECISION_ID}`;
      expect(rows.length).toBe(0);
    });

    it("bare unscoped-by-tenant query, a DIFFERENT real tenant's GUC set -- still ZERO rows (proves RLS, not merely an absent GUC, is what blocks this)", async () => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_B}, false)`;
      const rows = await sql`SELECT * FROM workflow.committee_votes WHERE decision_id = ${DECISION_ID}`;
      expect(rows.length).toBe(0);
    });

    it("bare unscoped-by-tenant query, the CORRECT tenant's GUC set -- returns the real row (RLS fails OPEN correctly too, not just closed)", async () => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`;
      const rows = await sql`SELECT * FROM workflow.committee_votes WHERE decision_id = ${DECISION_ID}`;
      expect(rows.length).toBe(1);
      expect(rows[0]?.["voter_id"]).toBe(VOTER_ID);
    });
  },
);
