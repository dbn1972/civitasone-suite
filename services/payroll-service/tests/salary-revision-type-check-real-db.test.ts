/**
 * HIGH regression (real Postgres, no mocks) -- PR #1756 independent review H1.
 *
 * POST /v1/payroll/salary-revisions accepts revisionType
 * "correction"/"fitment" (validators.ts zod enum) and the web form offers
 * both, but migration 0005's CHECK on payroll_salary_revisions.revision_type
 * only allowed annual_increment/promotion/special/pay_commission/
 * market_correction. The salaryRevisionCreate consumer's INSERT therefore
 * violated the CHECK for every correction/fitment: the API said 202, the UI
 * said submitted, and nothing was ever persisted.
 *
 * Migration 0050 widens the CHECK to the union. This drives the REAL
 * consumer (registerPayrollConsumers on a MemoryQueue) against a REAL,
 * migrated Postgres -- a mocked db could never have caught a DB CHECK.
 *
 * Requires DATABASE_URL to point at your own disposable, migrated (through
 * 0050) Postgres -- see vitest.config.ts's REL-035 note.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "50000000-1756-4000-8000-000000000001";
const ACTOR = "60000000-1756-4000-8000-000000000001";

type TxRunner = { execute: (q: unknown) => Promise<unknown> };

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return Array.from(result as Iterable<Record<string, unknown>>);
}

const settle = () => new Promise<void>((r) => setTimeout(r, 300));

async function publishRevision(q: MemoryQueue, id: string, employeeId: string, revisionType: string): Promise<void> {
  await runWithTenant(TENANT, async () => {
    await q.publish(COMMANDS.salaryRevisionCreate, {
      messageId: randomUUID(),
      type: COMMANDS.salaryRevisionCreate,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        id, tenantId: TENANT, employeeId, effectiveDate: "2026-04-01",
        oldBasicMinor: 4000000, newBasicMinor: revisionType === "correction" ? 3900000 : 4400000,
        oldGrossMinor: 8000000, newGrossMinor: 8800000,
        revisionType, orderNo: `ORD-${revisionType}`,
      },
    });
    await settle();
  });
}

async function revisionRows(ids: string[]): Promise<Array<Record<string, unknown>>> {
  return withTenantScope(db as never, TENANT, async (tx: TxRunner) =>
    rowsOf(await tx.execute(sql`
      SELECT id::text AS id, revision_type FROM payroll.payroll_salary_revisions
      WHERE tenant_id = ${TENANT}::uuid AND id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
      ORDER BY revision_type
    `)),
  );
}

describe("payroll_salary_revisions.revision_type CHECK -- real Postgres (PR #1756 review H1)", () => {
  afterAll(async () => {
    await withTenantScope(db as never, TENANT, async (tx: TxRunner) => {
      await tx.execute(sql`DELETE FROM payroll.payroll_salary_revisions WHERE tenant_id = ${TENANT}::uuid`);
    });
    await sqlClient.end();
  });

  it("migration 0050's CHECK is the union of the API enum and the legacy values", async () => {
    // pg_constraint is a system catalog -- no tenant scoping needed.
    const rows = rowsOf(await db.execute(sql`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'payroll.payroll_salary_revisions'::regclass
        AND conname = 'payroll_salary_revisions_revision_type_check'
    `));
    expect(rows).toHaveLength(1);
    const def = String(rows[0]!.def);
    for (const v of ["annual_increment", "promotion", "correction", "fitment", "special", "pay_commission", "market_correction"]) {
      expect(def).toContain(`'${v}'`);
    }
  });

  it("the salaryRevisionCreate consumer persists 'correction' and 'fitment' revisions", async () => {
    const q = new MemoryQueue();
    registerPayrollConsumers(q);
    await q.start();
    const correctionId = randomUUID();
    const fitmentId = randomUUID();
    try {
      await publishRevision(q, correctionId, randomUUID(), "correction");
      await publishRevision(q, fitmentId, randomUUID(), "fitment");
    } finally {
      await q.stop();
    }

    const rows = await revisionRows([correctionId, fitmentId]);
    expect(rows.map((r) => r.revision_type)).toEqual(["correction", "fitment"]);
  });

  it("still rejects a revision_type outside the union", async () => {
    await expect(
      withTenantScope(db as never, TENANT, async (tx: TxRunner) =>
        tx.execute(sql`
          INSERT INTO payroll.payroll_salary_revisions
            (tenant_id, employee_id, effective_date, old_basic_minor, new_basic_minor, old_gross_minor, new_gross_minor, revision_type)
          VALUES (${TENANT}::uuid, ${randomUUID()}::uuid, '2026-04-01', 1, 2, 3, 4, 'made_up_type')
        `),
      ),
    ).rejects.toThrow(/revision_type_check|check constraint/);
  });
});
