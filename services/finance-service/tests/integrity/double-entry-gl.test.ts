/**
 * Phase-4 Data Integrity — Check #1: Double-entry GL invariant.
 *
 * For every GL voucher/journal, SUM(debit_minor) must equal SUM(credit_minor).
 * We verify this two ways:
 *   (a) Behaviourally, through the real POST /v1/finance/journals path:
 *       a balanced journal is accepted (202); an UNBALANCED journal is rejected
 *       (400) by the route's Zod `.refine()` balance guard.
 *   (b) As an audit of the gl.finance_journals rows this file itself posted
 *       (read under its own tenant's GUC), asserting each voucher's lines sum
 *       to a zero net (debit == credit) and that at least one was inspected.
 *
 * NOTE (observation, not a Check-#1 violation): the `lines` JSONB column is
 * stored double-encoded — a JSONB *string* containing the JSON array, rather
 * than a JSONB array. The audit unwraps `lines #>> '{}'` before summing. All
 * existing vouchers balance once unwrapped.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { MemoryQueue } from "@civitasone/queue";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../../src/app.js";
import { sqlClient } from "../../src/shared/db.js";
import { queue } from "../../src/shared/infra.js";
import { registerGlConsumers } from "../../src/modules/gl/consumer.js";
import { financeHeads } from "../../src/modules/budget/schema.js";
import { scoped } from "../_tenant.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// This file's own tenant. It used to share aaaaaaaa-...-000000000001 with
// finance.test.ts, routes.test.ts, rls-isolation.test.ts and
// recon-invariants.test.ts, so what the audit below saw depended on which of
// those had run first. GL rows are append-only (0014_gl_immutability_reversal),
// so a fresh tenant per run is also what keeps reruns independent.
const TENANT = randomUUID();
const ACTOR = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
// The journal's two lines post against these head codes (see the "accepts a
// BALANCED journal" test below). journalPost's consumer resolves accountCode
// -> head via a tenant-scoped lookup (UNKNOWN_ACCOUNT_CODE if missing) —
// discovered while fixing this file: the POST was accepted (202) and drained
// clean, but the consumer's write then silently failed that lookup and landed
// in the DLQ, so the DB-wide audit saw zero journals. This tenant has no
// pre-seeded chart of accounts (unlike finance-core.test.ts's SEED_TENANT),
// so seed the two heads the test actually posts against.
const HEAD_1200 = randomUUID();
const HEAD_2100 = randomUUID();

function token(): string {
  return signToken(
    { sub: ACTOR, tid: TENANT, roles: ["finance_officer", "finance_admin", "super_admin"], sid: "sess-p4" },
    SECRET,
    3600,
  );
}

let app: FastifyInstance;

async function drain() {
  await (queue as MemoryQueue).drain();
}

async function seedHeads() {
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values([
    { id: HEAD_1200, tenantId: TENANT, code: "1200", name: "Fixed Assets (test)", level: 1, createdBy: ACTOR, updatedBy: ACTOR },
    { id: HEAD_2100, tenantId: TENANT, code: "2100", name: "Current Liabilities (test)", level: 1, createdBy: ACTOR, updatedBy: ACTOR },
  ]).onConflictDoNothing());
}

beforeAll(async () => {
  // F3 CQRS: POST /v1/finance/journals publishes a command and returns 202
  // immediately (queue.publish is fire-and-forget — see
  // @civitasone/queue-service's bus.ts). Without registering the GL consumer
  // here, the "real POST balance guard" test's balanced journal below never
  // actually lands, so the DB-wide audit that follows sees zero journals and
  // its own empty-pass guard fails. Mirrors the pattern in
  // supplementary-routes.test.ts / formulation-routes.test.ts.
  registerGlConsumers(queue);
  await seedHeads();
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await scoped(TENANT, (tx) => tx.delete(financeHeads).where(eq(financeHeads.id, HEAD_1200))).catch(() => {});
  await scoped(TENANT, (tx) => tx.delete(financeHeads).where(eq(financeHeads.id, HEAD_2100))).catch(() => {});
  await sqlClient.end();
});

describe("Check #1 — Double-entry GL: real POST balance guard", () => {
  it("accepts a BALANCED journal (debit == credit) with 202", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/journals",
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
      payload: {
        voucherNo: "AUTO",
        type: "journal",
        postingDate: "2024-04-01",
        lines: [
          { accountCode: "1200", debitMinor: 250000, creditMinor: 0 },
          { accountCode: "2100", debitMinor: 0, creditMinor: 250000 },
        ],
      },
    });
    expect(res.statusCode).toBe(202);
    // F3 CQRS: the 202 only means the command was accepted onto the queue —
    // MemoryQueue.publish is fire-and-forget (schedules delivery via
    // setTimeout(0) and returns before any handler runs). Drain so the
    // journal has actually landed before the DB-wide audit below reads it.
    await drain();
  });

  it("REJECTS an UNBALANCED journal (debit != credit) with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/finance/journals",
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
      payload: {
        voucherNo: "AUTO",
        type: "journal",
        postingDate: "2024-04-01",
        lines: [
          { accountCode: "1200", debitMinor: 250000, creditMinor: 0 },
          { accountCode: "2100", debitMinor: 0, creditMinor: 249999 }, // 1 paisa short
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});

// The audit reads under this file's own tenant GUC. It used to read
// gl.finance_journals DB-wide through civitas_admin, but that role is
// deliberately NOBYPASSRLS (infra/db/bootstrap/bootstrap_admin_role.sql) and
// the table is FORCE RLS, so the DB-wide read always returned zero rows: the
// "every voucher balances" test passed vacuously and the "inspected at least
// one" guard failed on every run, whatever other files had written. Auditing
// every tenant at once needs a deliberate audit-role decision (left open);
// what this file can prove on its own is that the vouchers it posted through
// the real route + consumer balance in the persisted rows.
const UNBALANCED_SQL = sql`
  WITH norm AS (
    SELECT id, voucher_no,
      CASE WHEN jsonb_typeof(lines) = 'string'
           THEN (lines #>> '{}')::jsonb ELSE lines END AS arr
    FROM gl.finance_journals
    WHERE tenant_id = ${TENANT}::uuid
  ), j AS (
    SELECT id, voucher_no,
      (SELECT COALESCE(SUM((l->>'debitMinor')::numeric), 0)
         FROM jsonb_array_elements(arr) l) AS dr,
      (SELECT COALESCE(SUM((l->>'creditMinor')::numeric), 0)
         FROM jsonb_array_elements(arr) l) AS cr
    FROM norm
    WHERE jsonb_typeof(arr) = 'array' AND jsonb_array_length(arr) > 0
  )
  SELECT id, voucher_no, dr::text AS dr, cr::text AS cr
  FROM j WHERE dr <> cr
`;

type UnbalancedRow = { id: string; voucher_no: string; dr: string; cr: string };

describe("Check #1 — Double-entry GL: audit of persisted vouchers", () => {
  it("every gl.finance_journals voucher this file posted balances (debit == credit)", async () => {
    // Unwrap string-encoded `lines` (see file header) before summing.
    const rows = (await scoped(TENANT, (tx) => tx.execute(UNBALANCED_SQL))) as unknown as UnbalancedRow[];
    if (rows.length > 0) {
      // FINDING: unbalanced voucher(s) persisted — double-entry broken.
      // eslint-disable-next-line no-console
      console.error(
        "[GL] UNBALANCED vouchers:",
        rows.map((r) => `${r.voucher_no}(dr=${r.dr},cr=${r.cr})`),
      );
    }
    expect(rows.map((r) => r.voucher_no)).toEqual([]);
  });

  it("negative control: a deliberately unbalanced voucher IS flagged by the audit (inserted, then rolled back)", async () => {
    // Proves the audit query can fail. The route refuses unbalanced journals
    // (see the 400 test above), so the bad voucher is written directly, inside
    // a transaction that is always rolled back: gl.finance_journals is
    // append-only, and nothing may persist.
    class RollbackControl extends Error {}
    const voucherNo = `NEG-CTRL-${randomUUID().slice(0, 8)}`;
    let flagged: UnbalancedRow[] = [];
    try {
      await scoped(TENANT, async (tx) => {
        await tx.execute(sql`
          INSERT INTO gl.finance_journals (tenant_id, voucher_no, type, posting_date, lines, created_by, updated_by)
          VALUES (${TENANT}::uuid, ${voucherNo}, 'journal', '2024-04-01',
                  ${JSON.stringify([
                    { accountCode: "1200", debitMinor: 250000, creditMinor: 0 },
                    { accountCode: "2100", debitMinor: 0, creditMinor: 249999 },
                  ])}::jsonb,
                  ${ACTOR}::uuid, ${ACTOR}::uuid)
        `);
        flagged = (await tx.execute(UNBALANCED_SQL)) as unknown as UnbalancedRow[];
        throw new RollbackControl();
      });
    } catch (err) {
      if (!(err instanceof RollbackControl)) throw err;
    }
    expect(flagged.map((r) => r.voucher_no)).toEqual([voucherNo]);
    expect(flagged[0]!.dr).toBe("250000");
    expect(flagged[0]!.cr).toBe("249999");
  });

  it("audit actually inspected the voucher this file posted (guard against empty pass)", async () => {
    const counted = (await scoped(TENANT, (tx) =>
      tx.execute(sql`SELECT count(*)::int AS n FROM gl.finance_journals WHERE tenant_id = ${TENANT}::uuid`),
    )) as unknown as Array<{ n: number }>;
    const n = counted[0]?.n;
    // Exactly the one balanced journal posted above; the unbalanced one was
    // rejected at the route (400) and must never have been persisted.
    expect(n).toBe(1);
  });
});
