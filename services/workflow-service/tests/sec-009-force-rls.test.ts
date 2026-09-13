/**
 * SEC-009 (workflow-service) — FORCE ROW LEVEL SECURITY on
 * workflow.nurture_rules (migration 0042_force_rls_sec_009.sql).
 *
 * workflow_svc is the OWNER of workflow.nurture_rules
 * (0036_nurture_rules.sql ran as workflow_svc — see
 * scripts/ci/bootstrap-postgres.sh's SERVICE_DBS loop). Postgres exempts a
 * table's OWNER from its own RLS policies unless FORCE ROW LEVEL SECURITY
 * is set. Before migration 0042, workflow_svc — the exact role the
 * application connects as (see vitest.config.ts's DATABASE_URL) — silently
 * bypassed the `tenant_isolation` policy entirely on any bare, unscoped
 * query.
 *
 * nurture_rules' policy uses the bare current_setting('app.tenant_id') form
 * (no `missing_ok`), so an unscoped query doesn't quietly evaluate to zero
 * rows -- Postgres rejects it the moment the policy expression is evaluated
 * (same shape as crm-service's equivalent of this test; contrast
 * estab-service/hrms-service, whose policies use the missing_ok form and
 * fail empty instead). The exact error text is connection-pool-history
 * dependent -- a session where app.tenant_id has never been touched raises
 * "unrecognized configuration parameter"; a pooled connection that already
 * saw a (transaction-local, since-reset) set_config call for it earlier, as
 * happens here since the seed step below runs on the same pool, has
 * Postgres treat the name as known and current_setting() returns '', which
 * then fails the policy's `::uuid` cast with "invalid input syntax for type
 * uuid" instead. Both are the same underlying phenomenon and equally prove
 * the fix; the test accepts either. Verified live against this migration
 * while building this test.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";

const TENANT = "5ec00090-0042-4020-8000-000000000001";

type TxRunner = { execute: (q: unknown) => Promise<unknown> };

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return Array.from(result as Iterable<Record<string, unknown>>);
}

describe("SEC-009 (workflow) — FORCE RLS strips workflow_svc's owner bypass", () => {
  afterAll(async () => {
    await sqlClient.end();
  });

  it("workflow.nurture_rules is ENABLE + FORCE (post-migration 0042 state)", async () => {
    const [state] = rowsOf(
      await sqlClient`
        SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'workflow.nurture_rules'::regclass
      `,
    );
    expect(state?.relrowsecurity).toBe(true);
    expect(state?.relforcerowsecurity).toBe(true);
  });

  it("workflow_svc (owner) with no tenant GUC set can no longer read its own row unscoped", async () => {
    const id = await withTenantScope(db as never, TENANT, async (tx: TxRunner) => {
      const rows = rowsOf(
        await tx.execute(sql`
          INSERT INTO workflow.nurture_rules (tenant_id, trigger_type, template_id, channel, created_by)
          VALUES (${TENANT}, 'score_below', ${randomUUID()}, 'email', ${randomUUID()})
          RETURNING id
        `),
      );
      const insertedId = rows[0]?.id;
      if (typeof insertedId !== "string") {
        throw new Error(`insert did not return an id: ${JSON.stringify(rows)}`);
      }
      return insertedId;
    });

    // No tenant context at all: db.transaction() with no runWithTenant/
    // withTenantScope ancestor never calls set_config, so app.tenant_id is
    // never set in this session. Before 0042 this silently returned the row
    // (owner bypass); after, the bare current_setting() policy raises.
    await expect(
      db.transaction((tx: TxRunner) =>
        tx.execute(sql`SELECT id FROM workflow.nurture_rules WHERE id = ${id}`),
      ),
    ).rejects.toThrow(/unrecognized configuration parameter|invalid input syntax for type uuid/i);

    // Positive control: the row genuinely exists and is readable through the
    // correctly tenant-scoped path.
    const scoped = await withTenantScope(db as never, TENANT, (tx: TxRunner) =>
      tx.execute(sql`SELECT id FROM workflow.nurture_rules WHERE id = ${id}`),
    );
    expect(rowsOf(scoped)).toHaveLength(1);
  });
});
