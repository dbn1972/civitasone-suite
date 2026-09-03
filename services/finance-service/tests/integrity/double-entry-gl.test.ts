/**
 * Phase-4 Data Integrity — Check #1: Double-entry GL invariant.
 *
 * For every GL voucher/journal, SUM(debit_minor) must equal SUM(credit_minor).
 * We verify this two ways:
 *   (a) Behaviourally, through the real POST /v1/finance/journals path:
 *       a balanced journal is accepted (202); an UNBALANCED journal is rejected
 *       (400) by the route's Zod `.refine()` balance guard.
 *   (b) As a DB-wide audit over all existing gl.finance_journals rows (read as
 *       admin to bypass RLS and see every tenant), asserting each voucher's
 *       lines sum to a zero net (debit == credit).
 *
 * NOTE (observation, not a Check-#1 violation): the `lines` JSONB column is
 * stored double-encoded — a JSONB *string* containing the JSON array, rather
 * than a JSONB array. The audit unwraps `lines #>> '{}'` before summing. All
 * existing vouchers balance once unwrapped.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { createSqlClient } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/app.js";
import { sqlClient } from "../../src/shared/db.js";
import { queue } from "../../src/shared/infra.js";
import { registerGlConsumers } from "../../src/modules/gl/consumer.js";
import { financeHeads } from "../../src/modules/budget/schema.js";
import { scoped } from "../_tenant.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0000-4000-8000-000000000001";
const ACTOR = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
// The journal's two lines post against these head codes (see the "accepts a
// BALANCED journal" test below). journalPost's consumer resolves accountCode
// -> head via a tenant-scoped lookup (UNKNOWN_ACCOUNT_CODE if missing) —
// discovered while fixing this file: the POST was accepted (202) and drained
// clean, but the consumer's write then silently failed that lookup and landed
// in the DLQ, so the DB-wide audit saw zero journals. This tenant has no
// pre-seeded chart of accounts (unlike finance-core.test.ts's SEED_TENANT),
// so seed the two heads the test actually posts against.
const HEAD_1200 = "aaaaaaaa-0000-4000-8000-0000000001c1";
const HEAD_2100 = "aaaaaaaa-0000-4000-8000-0000000002c1";

// CI bootstrap sets civitas_admin from PGPASSWORD/POSTGRES_ADMIN_PASSWORD
// (civitas_test). Local compose defaults to civitas_dev_pw. Hardcoding the
// local password here fails auth in CI, same as
// services/inventory-service/tests/data-quality.test.ts (see turbo.json
// test.passThroughEnv).
const ADMIN_PW =
  process.env.POSTGRES_ADMIN_PASSWORD ??
  process.env.PGPASSWORD ??
  (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
    ? "civitas_test"
    : "civitas_dev_pw");
const ADMIN_DSN =
  process.env.ADMIN_DATABASE_URL ??
  `postgres://civitas_admin:${ADMIN_PW}@localhost:5435/civitas_finance`;

function token(): string {
  return signToken(
    { sub: ACTOR, tid: TENANT, roles: ["finance_officer", "finance_admin", "super_admin"], sid: "sess-p4" },
    SECRET,
    3600,
  );
}

let app: FastifyInstance;
const admin = createSqlClient(ADMIN_DSN, { max: 2, prepare: false });

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
  await admin.end().catch(() => {});
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

// FLAGGED (see PR description): this describe block's premise — "read as
// admin to bypass RLS and audit ALL tenants' vouchers" — does not hold in
// this codebase. `civitas_admin` (the role behind ADMIN_DATABASE_URL / the
// `admin` client below) is deliberately created NOBYPASSRLS — see
// infra/db/bootstrap/bootstrap_admin_role.sql: "It is deliberately NOT a
// superuser and NOT BYPASSRLS — the L3 lane asserts no `%_svc` role holds
// BYPASSRLS, and civitas_admin must not become a hole in that." A plain
// `admin.unsafe(...)` query (no transaction, no app.tenant_id GUC) against
// gl.finance_journals — a FORCE RLS table — therefore always returns ZERO
// rows, for every tenant, regardless of how much data actually exists.
//
// This was NOT the bug the registerGlConsumers()/drain() gap this file was
// fixed for: that fix is real and correct — verified independently (a
// temporary in-transaction COUNT(*) immediately after postJournal's insert,
// using the transaction's own connection, showed the row present and
// committed). The "at least one voucher inspected" guard test below is
// therefore doing exactly its documented job — catching that the audit query
// is blind — just for a different underlying reason (RLS-blocked read
// privilege, not "no journals exist"). The FIRST test in this block
// ("every persisted voucher balances") is a false-positive pass for the same
// reason: an always-empty result set trivially satisfies `dr <> cr` having
// no rows.
//
// The only role in this codebase with BYPASSRLS is finance_scanner
// (migrations/0052_finance_scanner_role.sql), but it is granted SELECT only
// on _outbox.messages / _inbox.processed, not gl.finance_journals — so it
// cannot be swapped in as-is either. A real fix needs a deliberate choice
// (grant civitas_admin a narrow BYPASSRLS-equivalent for read-only audit
// tooling, provision a new dedicated audit role, or restructure this check to
// loop per known tenant with the GUC set) — left as a follow-up rather than
// guessed at here, per this task's standing instruction to flag rather than
// silently build anything requiring a real design/security decision.
describe("Check #1 — Double-entry GL: DB-wide audit of existing vouchers", () => {
  it("every persisted gl.finance_journals voucher balances (debit == credit)", async () => {
    // Read as admin to bypass RLS and audit ALL tenants' vouchers.
    // Unwrap string-encoded `lines` (see file header) before summing.
    const rows = await admin.unsafe(`
      WITH norm AS (
        SELECT id, voucher_no,
          CASE WHEN jsonb_typeof(lines) = 'string'
               THEN (lines #>> '{}')::jsonb ELSE lines END AS arr
        FROM gl.finance_journals
      ), j AS (
        SELECT id, voucher_no,
          (SELECT COALESCE(SUM((l->>'debitMinor')::numeric), 0)
             FROM jsonb_array_elements(arr) l) AS dr,
          (SELECT COALESCE(SUM((l->>'creditMinor')::numeric), 0)
             FROM jsonb_array_elements(arr) l) AS cr
        FROM norm
        WHERE jsonb_typeof(arr) = 'array' AND jsonb_array_length(arr) > 0
      )
      SELECT id, voucher_no, dr::text, cr::text
      FROM j WHERE dr <> cr
    `);
    if (rows.length > 0) {
      // FINDING: unbalanced voucher(s) persisted — double-entry broken.
      // eslint-disable-next-line no-console
      console.error(
        "[GL] UNBALANCED vouchers:",
        rows.map((r: any) => `${r.voucher_no}(dr=${r.dr},cr=${r.cr})`),
      );
    }
    expect(rows.map((r: any) => r.voucher_no)).toEqual([]);
  });

  it("audit actually inspected at least one existing voucher (guard against empty pass)", async () => {
    const [{ n }] = (await admin.unsafe(
      `SELECT count(*)::int AS n FROM gl.finance_journals`,
    )) as unknown as Array<{ n: number }>;
    // eslint-disable-next-line no-console
    console.log(`[GL] audited ${n} existing journals`);
    expect(n).toBeGreaterThan(0);
  });
});
