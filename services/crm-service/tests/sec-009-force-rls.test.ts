/**
 * SEC-009 (crm-service) — FORCE ROW LEVEL SECURITY on 10 crm_svc-owned
 * tables (migration 0092_force_rls_sec_009.sql).
 *
 * crm_svc is the OWNER of every crm.* table (it ran the CREATE TABLE
 * migrations itself — see scripts/ci/bootstrap-postgres.sh's SERVICE_DBS
 * loop, which applies non-role-creating migrations as the service role).
 * Postgres exempts a table's OWNER from its own RLS policies unless FORCE
 * ROW LEVEL SECURITY is set. Before migration 0092, these 10 tables had
 * ENABLE but not FORCE, so crm_svc — the exact role the application
 * connects as (see vitest.config.ts's DATABASE_URL) — silently bypassed
 * tenant_isolation_* entirely on any bare, unscoped query.
 *
 * 8 of these 10 tables are the ones named in the SEC-009 gap-report
 * evidence cell (docs/ENTERPRISE-GAP-REPORT-2026-09-07.md). The other two —
 * crm.subscriptions (0077_subscriptions.sql) and crm.service_requests
 * (0080_service_requests.sql) — were found verifying that cell against the
 * actual migrations: both have the identical ENABLE-without-FORCE gap and a
 * real tenant_isolation_* policy, but were not named in the row (the same
 * undercount pattern SEC-002's own fix flagged in its evidence cell). Fixed
 * and covered here too; see the gap-report update in this PR.
 *
 * IMPORTANT — crm's tenant_isolation_* policies use the bare
 * current_setting('app.tenant_id') form (no `missing_ok` true argument, see
 * e.g. 0075_appointments.sql). That means a query with the GUC never set in
 * that session doesn't quietly evaluate to zero rows the way a
 * `current_setting(key, true)` policy would (see the estab-service and
 * hrms-service equivalents of this test) — Postgres rejects it the moment
 * the policy expression is evaluated. Verified live against this exact
 * migration (before: silent bypass, saw the row; after: rejected) while
 * building this test. The exact error text is connection-pool-history
 * dependent: a session where app.tenant_id has never been touched raises
 * "unrecognized configuration parameter"; a pooled connection that already
 * saw a (transaction-local, since-reset) set_config call for it earlier —
 * as happens here, since the seed step above runs on the same pool — has
 * Postgres treat the name as known and current_setting() returns '', which
 * then fails the policy's `::uuid` cast with "invalid input syntax for type
 * uuid". Both are the same underlying phenomenon (the owner can no longer
 * resolve a real tenant id) and equally prove the fix; the test accepts
 * either.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";

const TENANT = "5ec00090-0009-4020-8000-000000000001";

type TxRunner = { execute: (q: unknown) => Promise<unknown> };

interface TableSpec {
  qualified: string;
  insert: (tx: TxRunner, tenantId: string) => Promise<string>;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return Array.from(result as Iterable<Record<string, unknown>>);
}

function shortCode(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 12)}`;
}

async function insertReturningId(tx: TxRunner, query: ReturnType<typeof sql>): Promise<string> {
  const result = await tx.execute(query);
  const rows = rowsOf(result);
  const id = rows[0]?.id;
  if (typeof id !== "string") {
    throw new Error(`insert did not return an id: ${JSON.stringify(rows)}`);
  }
  return id;
}

const TABLES: TableSpec[] = [
  {
    qualified: "crm.pending_campaigns",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO crm.pending_campaigns (tenant_id, channel, template_id, created_by)
            VALUES (${t}, 'email', ${randomUUID()}, ${randomUUID()}) RETURNING id`,
      ),
  },
  {
    qualified: "crm.canned_responses",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO crm.canned_responses (tenant_id, title, body, channel, created_by)
            VALUES (${t}, 'sec-009 probe', 'body', 'email', ${randomUUID()}) RETURNING id`,
      ),
  },
  {
    qualified: "crm.commission_rules",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO crm.commission_rules (tenant_id, name, type, rate_type, rate_value, created_by)
            VALUES (${t}, 'sec-009 probe', 'referral', 'fixed', 100, ${randomUUID()}) RETURNING id`,
      ),
  },
  {
    qualified: "crm.commission_ledger",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO crm.commission_ledger (tenant_id, agent_id, deal_id, rule_id, amount_minor, period)
            VALUES (${t}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, 1000, '2026-09') RETURNING id`,
      ),
  },
  {
    qualified: "crm.referrals",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO crm.referrals (tenant_id, referrer_id, referred_contact_id)
            VALUES (${t}, ${randomUUID()}, ${randomUUID()}) RETURNING id`,
      ),
  },
  {
    qualified: "crm.appointments",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO crm.appointments (tenant_id, contact_id, service_type, scheduled_at, created_by)
            VALUES (${t}, ${randomUUID()}, 'consult', now(), ${randomUUID()}) RETURNING id`,
      ),
  },
  {
    qualified: "crm.subscriptions",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO crm.subscriptions
              (tenant_id, contact_id, product_id, type, start_date, frequency, amount_minor, created_by)
            VALUES (${t}, ${randomUUID()}, ${randomUUID()}, 'recurring', now()::date, 'monthly', 1000, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "crm.service_requests",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO crm.service_requests (tenant_id, citizen_name, service_type, subject, created_by, updated_by)
            VALUES (${t}, 'sec-009 probe citizen', 'certificate', 'sec-009 probe', ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "crm.grievances",
    // status has a column DEFAULT of 'open', but 0082_cpgrams_alignment.sql
    // (applied after 0079 created this table) replaced the status CHECK
    // constraint with a CPGRAMS vocabulary that no longer accepts 'open' --
    // the default itself was never updated to match. Pre-existing,
    // unrelated to SEC-009; worked around here by setting status explicitly
    // rather than relying on the (now-invalid) default.
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO crm.grievances (tenant_id, citizen_name, category, subject, status, created_by, updated_by)
            VALUES (${t}, 'sec-009 probe citizen', 'sanitation', 'sec-009 probe', 'REGISTERED', ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "crm.rti_requests",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO crm.rti_requests
              (tenant_id, reference_no, section, department_ref, applicant_name, subject, description, created_by)
            VALUES (${t}, ${shortCode("SEC009")}, 's.6', 'dept-ref', 'sec-009 probe applicant', 'subject', 'description', ${randomUUID()})
            RETURNING id`,
      ),
  },
];

describe("SEC-009 (crm) — table coverage", () => {
  it("covers exactly the 10 crm tables verified ENABLE-without-FORCE before migration 0092", () => {
    expect(TABLES.map((t) => t.qualified).sort()).toEqual(
      [
        "crm.pending_campaigns",
        "crm.canned_responses",
        "crm.commission_rules",
        "crm.commission_ledger",
        "crm.referrals",
        "crm.appointments",
        "crm.subscriptions",
        "crm.service_requests",
        "crm.grievances",
        "crm.rti_requests",
      ].sort(),
    );
  });
});

describe("SEC-009 (crm) — FORCE RLS strips crm_svc's owner bypass", () => {
  afterAll(async () => {
    await sqlClient.end();
  });

  for (const { qualified, insert } of TABLES) {
    describe(qualified, () => {
      it("ENABLE + FORCE ROW LEVEL SECURITY are both set (post-migration 0092 state)", async () => {
        const [state] = rowsOf(
          await sqlClient`
            SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ${qualified}::regclass
          `,
        );
        expect(state?.relrowsecurity).toBe(true);
        expect(state?.relforcerowsecurity).toBe(true);
      });

      it("crm_svc (table owner) with no tenant GUC set can no longer read its own row unscoped", async () => {
        const id = await withTenantScope(db as never, TENANT, (tx: TxRunner) => insert(tx, TENANT));

        // No tenant context at all -- db.transaction() with no runWithTenant
        // wrapping never calls set_config, so this call never sets a
        // *resolvable* app.tenant_id. Before 0092 this silently returned the
        // row (owner bypass); after, crm's bare current_setting('app.tenant_id')
        // policy rejects it -- see the file-header comment for why the exact
        // message varies with connection-pool history.
        await expect(
          db.transaction((tx: TxRunner) =>
            tx.execute(sql`SELECT id FROM ${sql.raw(qualified)} WHERE id = ${id}`),
          ),
        ).rejects.toThrow(/unrecognized configuration parameter|invalid input syntax for type uuid/i);

        // Positive control: the row genuinely exists and is readable through
        // the correctly tenant-scoped path.
        const scoped = await withTenantScope(db as never, TENANT, (tx: TxRunner) =>
          tx.execute(sql`SELECT id FROM ${sql.raw(qualified)} WHERE id = ${id}`),
        );
        expect(rowsOf(scoped)).toHaveLength(1);
      });
    });
  }
});
