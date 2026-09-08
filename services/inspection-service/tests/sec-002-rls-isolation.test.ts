/**
 * SEC-002 — Cross-Tenant RLS Isolation for the 21 previously-unprotected
 * inspection-service tables (migration 0029_sec_002_rls_isolation.sql).
 *
 * Before 0029, these tables (capa.corrective_actions, enforcement.*,
 * licence.*, survey.*, telemetry.*, encroachment.*, illegal_construction.*)
 * had NO Row Level Security at all — isolation depended entirely on every
 * repo.ts call remembering a `WHERE tenant_id = $1` clause, with zero
 * database-level backstop.
 *
 * This proves the backstop directly against Postgres, independent of any
 * particular HTTP route's own tenant-scoping logic:
 *   1. Tenant A inserts a row (via withTenantScope, which sets the
 *      `app.tenant_id` GUC per packages/db/src/tenant-scope.ts).
 *   2. Tenant B, in its own transaction, must see ZERO rows when selecting
 *      by that row's id — the cross-tenant read the DoD requires.
 *   3. A transaction with NO tenant context at all (GUC never set) must
 *      also see ZERO rows — this is what FORCE ROW LEVEL SECURITY buys
 *      over plain ENABLE: it strips the table-owner bypass, which is the
 *      actual attack fixed here (the service's DB role owns these tables).
 *   4. Tenant A can still read its own row (positive control — proves the
 *      policy isn't simply denying everyone).
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";

const TENANT_A = "aaaaaaaa-5ec0-4020-8000-000000000001";
const TENANT_B = "bbbbbbbb-5ec0-4020-8000-000000000002";

type TxRunner = { execute: (q: unknown) => Promise<unknown> };

interface TableSpec {
  /** schema.table, used for the SELECT and for the pg_class assertions. */
  qualified: string;
  /** Inserts one row as the given tenant and returns its id. */
  insert: (tx: TxRunner, tenantId: string) => Promise<string>;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  // postgres.js/drizzle both return an array-like with the rows.
  return Array.from(result as Iterable<Record<string, unknown>>);
}

/** Short unique code for varchar(40)-limited "number" columns (complaint_number etc). */
function shortCode(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 12)}`;
}

async function insertReturningId(
  tx: TxRunner,
  query: ReturnType<typeof sql>,
): Promise<string> {
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
    qualified: "capa.corrective_actions",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO capa.corrective_actions
              (tenant_id, finding_id, type, description, created_by, updated_by)
            VALUES (${t}, ${randomUUID()}, 'corrective', 'sec-002 probe', ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "enforcement.penalty_rates",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO enforcement.penalty_rates
              (tenant_id, provision_id, effective_from, amount, created_by, updated_by)
            VALUES (${t}, ${randomUUID()}, now()::date, 100000, ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "enforcement.show_cause_notices",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO enforcement.show_cause_notices
              (tenant_id, finding_id, entity_id, issued_to, response_deadline, created_by, updated_by)
            VALUES (${t}, ${randomUUID()}, ${randomUUID()}, 'sec-002 probe', now()::date + 14, ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "enforcement.penalty_orders",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO enforcement.penalty_orders
              (tenant_id, finding_id, entity_id, amount, maker_user_id, created_by, updated_by)
            VALUES (${t}, ${randomUUID()}, ${randomUUID()}, 50000, ${randomUUID()}, ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "enforcement.prosecution_referrals",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO enforcement.prosecution_referrals
              (tenant_id, penalty_order_id, finding_id, entity_id, referred_by, created_by, updated_by)
            VALUES (${t}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "licence.licences",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO licence.licences
              (tenant_id, entity_id, licence_type, licence_number, valid_from, valid_to, created_by, updated_by)
            VALUES (${t}, ${randomUUID()}, 'trade', ${"SEC002-" + randomUUID()}, now()::date, now()::date + 365, ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "licence.licence_conditions",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO licence.licence_conditions
              (tenant_id, licence_id, condition_text, created_by, updated_by)
            VALUES (${t}, ${randomUUID()}, 'sec-002 probe', ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "survey.survey_definitions",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO survey.survey_definitions
              (tenant_id, title, target_entity_type, questionnaire, sampling_method, sample_size_percent, created_by, updated_by)
            VALUES (${t}, 'sec-002 probe', 'regulated_entity', ${sql.raw("'{}'::jsonb")}, 'random', 10.00, ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "survey.sampling_frames",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO survey.sampling_frames
              (tenant_id, survey_id, entity_ids, total_population, sample_size, created_by)
            VALUES (${t}, ${randomUUID()}, ${sql.raw("'[]'::jsonb")}, 100, 10, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "survey.survey_responses",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO survey.survey_responses
              (tenant_id, survey_id, entity_id, inspector_id, answers, captured_at, created_by, updated_by)
            VALUES (${t}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()}, ${sql.raw("'{}'::jsonb")}, now(), ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "survey.survey_aggregations",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO survey.survey_aggregations
              (tenant_id, survey_id, response_count, response_rate, question_summaries)
            VALUES (${t}, ${randomUUID()}, 5, 50.00, ${sql.raw("'{}'::jsonb")})
            RETURNING id`,
      ),
  },
  {
    qualified: "telemetry.devices",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO telemetry.devices
              (tenant_id, device_type, device_identifier, name, created_by, updated_by)
            VALUES (${t}, 'sensor', ${"SEC002-DEV-" + randomUUID()}, 'sec-002 probe device', ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "telemetry.telemetry_readings",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO telemetry.telemetry_readings
              (tenant_id, device_id, reading_type, value, unit, captured_at)
            VALUES (${t}, ${randomUUID()}, 'temperature', 42.5, 'celsius', now())
            RETURNING id`,
      ),
  },
  {
    qualified: "telemetry.telemetry_alerts",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO telemetry.telemetry_alerts
              (tenant_id, device_id, alert_type, severity, created_by, updated_by)
            VALUES (${t}, ${randomUUID()}, 'threshold_exceeded', 'minor', ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "telemetry.alert_rules",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO telemetry.alert_rules
              (tenant_id, device_type, reading_type, operator, threshold_value, severity, created_by, updated_by)
            VALUES (${t}, 'sensor', 'temperature', 'gt', 100, 'minor', ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "encroachment.encroachment_complaints",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO encroachment.encroachment_complaints
              (tenant_id, complaint_number, reported_by, location, encroachment_type, description, created_by, updated_by)
            VALUES (${t}, ${shortCode("SEC002")}, ${randomUUID()}, ${sql.raw("'{}'::jsonb")}, 'road_encroachment', 'sec-002 probe', ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "encroachment.encroachment_notices",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO encroachment.encroachment_notices
              (tenant_id, complaint_id, notice_number, notice_type, issued_to, response_deadline, created_by, updated_by)
            VALUES (${t}, ${randomUUID()}, ${shortCode("SEC002")}, 'show_cause', 'sec-002 probe', now()::date + 14, ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "encroachment.encroachment_hearings",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO encroachment.encroachment_hearings
              (tenant_id, complaint_id, notice_id, hearing_date, hearing_time, venue, officer_id, created_by, updated_by)
            VALUES (${t}, ${randomUUID()}, ${randomUUID()}, now()::date + 7, '10:00:00', 'sec-002 probe venue', ${randomUUID()}, ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "encroachment.encroachment_removals",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO encroachment.encroachment_removals
              (tenant_id, complaint_id, ordered_by, scheduled_date, created_by, updated_by)
            VALUES (${t}, ${randomUUID()}, ${randomUUID()}, now()::date + 7, ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "illegal_construction.illegal_construction_cases",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO illegal_construction.illegal_construction_cases
              (tenant_id, case_number, reported_by, location, owner_name, violation_type, description, created_by, updated_by)
            VALUES (${t}, ${shortCode("SEC002")}, ${randomUUID()}, ${sql.raw("'{}'::jsonb")}, 'sec-002 probe owner', 'no_permit', 'sec-002 probe', ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
  {
    qualified: "illegal_construction.illegal_construction_actions",
    insert: (tx, t) =>
      insertReturningId(
        tx,
        sql`INSERT INTO illegal_construction.illegal_construction_actions
              (tenant_id, case_id, action_type, action_number, issued_by, created_by, updated_by)
            VALUES (${t}, ${randomUUID()}, 'fine', ${shortCode("SEC002")}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()})
            RETURNING id`,
      ),
  },
];

// Sanity: the DoD is "L1 lane covers each of the 23 [verified: 21] tables".
// Fails loudly if a table is ever added to migrations 0011-0028 without a
// matching RLS entry in 0029 AND a matching probe here.
describe("SEC-002 — table coverage", () => {
  it("covers exactly the 21 tables verified to have zero RLS before migration 0029", () => {
    expect(TABLES.map((t) => t.qualified).sort()).toEqual(
      [
        "capa.corrective_actions",
        "enforcement.penalty_rates",
        "enforcement.show_cause_notices",
        "enforcement.penalty_orders",
        "enforcement.prosecution_referrals",
        "licence.licences",
        "licence.licence_conditions",
        "survey.survey_definitions",
        "survey.sampling_frames",
        "survey.survey_responses",
        "survey.survey_aggregations",
        "telemetry.devices",
        "telemetry.telemetry_readings",
        "telemetry.telemetry_alerts",
        "telemetry.alert_rules",
        "encroachment.encroachment_complaints",
        "encroachment.encroachment_notices",
        "encroachment.encroachment_hearings",
        "encroachment.encroachment_removals",
        "illegal_construction.illegal_construction_cases",
        "illegal_construction.illegal_construction_actions",
      ].sort(),
    );
  });
});

describe("SEC-002 — Cross-Tenant RLS Isolation", () => {
  afterAll(async () => {
    await sqlClient.end();
  });

  for (const { qualified, insert } of TABLES) {
    describe(qualified, () => {
      it("ENABLE + FORCE ROW LEVEL SECURITY are both set (post-migration 0029 state)", async () => {
        const [state] = rowsOf(
          await sqlClient`
            SELECT relrowsecurity, relforcerowsecurity
            FROM pg_class
            WHERE oid = ${qualified}::regclass
          `,
        );
        expect(state?.relrowsecurity).toBe(true);
        expect(state?.relforcerowsecurity).toBe(true);
      });

      it("tenant B cannot read tenant A's row (cross-tenant read is empty)", async () => {
        const id = await withTenantScope(db as never, TENANT_A, (tx: TxRunner) => insert(tx, TENANT_A));

        const bResult = await withTenantScope(db as never, TENANT_B, (tx: TxRunner) =>
          tx.execute(sql`SELECT id FROM ${sql.raw(qualified)} WHERE id = ${id}`),
        );
        expect(rowsOf(bResult)).toHaveLength(0);

        // No tenant context at all: proves FORCE strips the table-owner
        // bypass (the service DB role owns these tables and is NOBYPASSRLS,
        // but without FORCE the owner is still exempt from its own RLS).
        const noContextResult = await db.transaction((tx: TxRunner) =>
          tx.execute(sql`SELECT id FROM ${sql.raw(qualified)} WHERE id = ${id}`),
        );
        expect(rowsOf(noContextResult)).toHaveLength(0);

        // Positive control: tenant A can still read its own row.
        const aResult = await withTenantScope(db as never, TENANT_A, (tx: TxRunner) =>
          tx.execute(sql`SELECT id FROM ${sql.raw(qualified)} WHERE id = ${id}`),
        );
        expect(rowsOf(aResult)).toHaveLength(1);
      });
    });
  }
});
