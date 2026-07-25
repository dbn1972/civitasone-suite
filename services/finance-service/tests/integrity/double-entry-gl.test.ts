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
import { buildApp } from "../../src/app.js";
import { sqlClient } from "../../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0000-4000-8000-000000000001";
const ACTOR = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";

const ADMIN_DSN =
  process.env.ADMIN_DATABASE_URL ??
  "postgres://civitas_admin:civitas_dev_pw@localhost:5435/civitas_finance";

function token(): string {
  return signToken(
    { sub: ACTOR, tid: TENANT, roles: ["finance_officer", "finance_admin", "super_admin"], sid: "sess-p4" },
    SECRET,
    3600,
  );
}

let app: FastifyInstance;
const admin = createSqlClient(ADMIN_DSN, { max: 2, prepare: false });

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
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
