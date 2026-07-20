/**
 * Format router integration tests — verifies the bank-file endpoint's
 * format query param dispatches correctly for csv, nach, and apbs.
 *
 * Uses HS256 test JWTs (JWT_ALGORITHM=HS256 set in vitest.config.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { sqlClient } from "../src/shared/db.js";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-6666-4000-8000-000000000066";
const ACTOR = "00000000-0000-4000-8000-000000000099";

const RUN_ID = "11111111-1111-4000-8000-000000000001";
const STRUCT_ID = "33333333-3333-4000-8000-000000000001";
const EMP_ID_1 = "22222222-2222-4000-8000-000000000001";
const EMP_ID_2 = "22222222-2222-4000-8000-000000000002";

function makeToken(roles: string[] = ["payroll_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-fmt-001" }, SECRET);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();

  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    // Seed a pay structure (required FK for payroll_runs.structure_id)
    await tx.execute(sql`
      INSERT INTO payroll.payroll_structures (id, tenant_id, name, created_by, updated_by)
      VALUES (${STRUCT_ID}::uuid, ${TENANT}::uuid, 'Test Structure', ${ACTOR}::uuid, ${ACTOR}::uuid)
      ON CONFLICT (id) DO NOTHING
    `);

    // Seed a payroll run + slips for this tenant
    await tx.execute(sql`
      INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, run_type, structure_id, status, created_by, updated_by)
      VALUES (${RUN_ID}::uuid, ${TENANT}::uuid, 'RUN-001', '2026-07', 'pensioner', ${STRUCT_ID}::uuid, 'approved', ${ACTOR}::uuid, ${ACTOR}::uuid)
      ON CONFLICT (id) DO NOTHING
    `);

    await tx.execute(sql`
      INSERT INTO payroll.payroll_slips (id, tenant_id, run_id, employee_id, employee_no, net_pay_minor, created_by, updated_by)
      VALUES
        (${randomUUID()}::uuid, ${TENANT}::uuid, ${RUN_ID}::uuid, ${EMP_ID_1}::uuid, 'EMP001', 5000000, ${ACTOR}::uuid, ${ACTOR}::uuid),
        (${randomUUID()}::uuid, ${TENANT}::uuid, ${RUN_ID}::uuid, ${EMP_ID_2}::uuid, 'EMP002', 3500000, ${ACTOR}::uuid, ${ACTOR}::uuid)
      ON CONFLICT DO NOTHING
    `);
  }));
});

afterAll(async () => {
  // Cleanup test data
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM payroll.payroll_slips WHERE run_id = ${RUN_ID}::uuid`);
    await tx.execute(sql`DELETE FROM payroll.payroll_runs WHERE id = ${RUN_ID}::uuid`);
    await tx.execute(sql`DELETE FROM payroll.payroll_pensioners WHERE tenant_id = ${TENANT}::uuid`);
    await tx.execute(sql`DELETE FROM payroll.sponsor_bank_config WHERE tenant_id = ${TENANT}::uuid`);
    await tx.execute(sql`DELETE FROM payroll.payroll_structures WHERE id = ${STRUCT_ID}::uuid`);
  }));
  await app.close();
  await sqlClient.end();
});

/**
 * Helper to seed HRMS payroll-input mock. The existing route calls
 * fetchPayrollInput which hits HRMS internally. For tests, we mock
 * the HRMS response via a local HTTP server or set env appropriately.
 *
 * Since tests run with QUEUE_DRIVER=memory and the HRMS may not be up,
 * we seed employee bank data directly into a pensioner table that the
 * route will query (use run_type=pensioner to bypass HRMS call).
 */
async function seedPensionerMaster() {
  // Run is already type 'pensioner', so it reads from payroll_pensioners instead of HRMS
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO payroll.payroll_pensioners (id, tenant_id, ppo_no, full_name, date_of_birth, basic_pension_minor, bank_account_no, bank_ifsc, created_by, updated_by)
      VALUES
        (${EMP_ID_1}::uuid, ${TENANT}::uuid, 'PPO001', 'Rajesh Kumar', '1960-01-15', 5000000, '1234567890123', 'SBIN0001234', ${ACTOR}::uuid, ${ACTOR}::uuid),
        (${EMP_ID_2}::uuid, ${TENANT}::uuid, 'PPO002', 'Suresh Patel', '1962-06-20', 3500000, '9876543210123', 'HDFC0005678', ${ACTOR}::uuid, ${ACTOR}::uuid)
      ON CONFLICT (id) DO UPDATE SET
        bank_account_no = EXCLUDED.bank_account_no,
        bank_ifsc = EXCLUDED.bank_ifsc,
        full_name = EXCLUDED.full_name
    `);
  }));
}

async function seedSponsorConfig(overrides: Record<string, unknown> = {}) {
  const defaults = {
    sponsorCode: "SBIN",
    sponsorIfsc: "SBIN0000001",
    sponsorAccount: "9999888877776666",
    utilityCode: "NACH00000000012",
    userNumber: "USR001",
    settlementOffsetDays: 1,
    nachEnabled: true,
    apbsEnabled: false,
    maxRecordsPerFile: 100000,
    maxAmountPerFileMinor: "1000000000",
  };
  const body = { ...defaults, ...overrides };

  const token = makeToken();
  await app.inject({
    method: "PUT",
    url: "/v1/payroll/sponsor-bank-config",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: body,
  });
}

async function removeSponsorConfig() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM payroll.sponsor_bank_config WHERE tenant_id = ${TENANT}::uuid`);
  }));
  // Also invalidate the cache so subsequent reads don't serve stale data
  const { cache } = await import("../src/shared/infra.js");
  await cache.invalidate(cache.makeKey(TENANT, "sponsor_bank_config", TENANT));
}

// ═══════════════════════════════════════════════════════════════════
// CSV backward compatibility
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/runs/:id/bank-file?format=csv (backward compat)", () => {
  it("returns CSV with default format (no query param)", async () => {
    await seedPensionerMaster();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(".csv");
    expect(res.body).toContain("Employee No,Name,Bank Account,IFSC,Net Pay Amount,Narration");
    expect(res.body).toContain("TRAILER");
  });

  it("returns CSV with explicit format=csv", async () => {
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file?format=csv`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
  });
});

// ═══════════════════════════════════════════════════════════════════
// NACH format
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/runs/:id/bank-file?format=nach", () => {
  it("returns text/plain with .txt filename when sponsor config exists", async () => {
    await seedPensionerMaster();
    await seedSponsorConfig();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file?format=nach`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.headers["content-disposition"]).toContain(".txt");

    // Verify NACH fixed-width structure: each line exactly 160 chars
    const lines = res.body.split("\r\n").filter((l: string) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(4); // header + 2 details + batch ctrl + file ctrl
    for (const line of lines) {
      expect(line.length).toBe(160);
    }

    // Header starts with "01"
    expect(lines[0].slice(0, 2)).toBe("01");
    // Detail records start with "02"
    expect(lines[1].slice(0, 2)).toBe("02");
    expect(lines[2].slice(0, 2)).toBe("02");
    // Batch control starts with "03"
    expect(lines[3].slice(0, 2)).toBe("03");
    // File control starts with "04"
    expect(lines[4].slice(0, 2)).toBe("04");

    await removeSponsorConfig();
  });

  it("returns 422 SPONSOR_CONFIG_MISSING without sponsor config", async () => {
    await removeSponsorConfig();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file?format=nach`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SPONSOR_CONFIG_MISSING");
  });

  it("returns 422 BANK_DETAILS_MISSING when beneficiary has invalid IFSC", async () => {
    await seedSponsorConfig();

    // Set one pensioner's IFSC to invalid
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE payroll.payroll_pensioners SET bank_ifsc = 'INVALID' WHERE id = ${EMP_ID_1}::uuid
      `);
    }));

    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file?format=nach`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("BANK_DETAILS_MISSING");

    // Restore valid IFSC
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE payroll.payroll_pensioners SET bank_ifsc = 'SBIN0001234' WHERE id = ${EMP_ID_1}::uuid
      `);
    }));
    await removeSponsorConfig();
  });
});

// ═══════════════════════════════════════════════════════════════════
// APBS format
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/runs/:id/bank-file?format=apbs", () => {
  it("returns 422 APBS_NOT_ENABLED when apbs_enabled=false", async () => {
    await seedSponsorConfig({ apbsEnabled: false });
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file?format=apbs`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("APBS_NOT_ENABLED");
    await removeSponsorConfig();
  });

  it("returns 422 SPONSOR_CONFIG_MISSING without config", async () => {
    await removeSponsorConfig();
    const token = makeToken();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file?format=apbs`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SPONSOR_CONFIG_MISSING");
  });
});
