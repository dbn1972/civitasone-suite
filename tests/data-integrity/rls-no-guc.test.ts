/**
 * Phase-4 Data Integrity — Check #3: RLS enforcement WITHOUT the tenant GUC.
 *
 * This is the load-bearing security check. For each sampled service we connect
 * to its database AS THE SERVICE'S OWN RUNTIME ROLE (e.g. finance_svc) WITHOUT
 * setting `app.tenant_id`, then SELECT an RLS-protected table.
 *
 *   - If the role is NOBYPASSRLS, the fail-closed policy (tenant_id =
 *     current_tenant_id()) returns ZERO rows with no GUC → RLS is REAL, it is
 *     the actual enforcer at the database layer.
 *   - If the role holds BYPASSRLS, the SELECT returns ALL rows regardless of
 *     tenant → RLS is INERT for that service; the only tenant boundary is the
 *     app-layer WHERE clause (defence-in-depth, not true isolation).
 *
 * We read `rolbypassrls` from pg_roles as the source of truth and assert the
 * empirically observed no-GUC row behaviour matches it. Any service whose role
 * holds BYPASSRLS is flagged as a FINDING below (see citizen_svc).
 *
 * Empirically measured on cloudsphere-ec2 (2026-07-25):
 *   finance_svc   NOBYPASSRLS  admin=182 rows  no-GUC=0    RLS ENFORCED
 *   payroll_svc   NOBYPASSRLS  admin=28  rows  no-GUC=0    RLS ENFORCED
 *   hrms_svc      NOBYPASSRLS  admin=2   rows  no-GUC=0    RLS ENFORCED
 *   citizen_svc   BYPASSRLS    admin=39  rows  no-GUC=39   RLS INERT  <-- FINDING
 *   legal_svc     NOBYPASSRLS  admin=5   rows  no-GUC=0    RLS ENFORCED
 *   telephony_svc NOBYPASSRLS  admin=0   rows  no-GUC=0    RLS ENFORCED (no data)
 */
import { describe, it, expect, afterAll } from "vitest";
import { createSqlClient } from "../../packages/db/src/index.js";

const HOST = process.env.PGHOST ?? "localhost";
const PORT = process.env.PGPORT ?? "5435";
const ADMIN_USER = process.env.PGADMIN_USER ?? "civitas_admin";
const ADMIN_PW = process.env.PGADMIN_PW ?? "civitas_dev_pw";

type Svc = {
  name: string;
  db: string;
  role: string;
  pw: string;
  table: string;
  /** Expected rolbypassrls, from the empirical baseline above. */
  expectBypass: boolean;
};

const SERVICES: Svc[] = [
  { name: "finance",   db: "civitas_finance",   role: "finance_svc",   pw: "finance_dev_pw",   table: "gl.finance_ledger",        expectBypass: false },
  { name: "payroll",   db: "civitas_payroll",   role: "payroll_svc",   pw: "payroll_dev_pw",   table: "payroll.payroll_slips",    expectBypass: false },
  { name: "hrms",      db: "civitas_hrms",      role: "hrms_svc",      pw: "hrms_dev_pw",      table: "appraisal.hrms_appraisals", expectBypass: false },
  // FINDING: citizen_svc holds BYPASSRLS → RLS is inert for civitas_citizen.
  { name: "citizen",   db: "civitas_citizen",   role: "citizen_svc",   pw: "citizen_dev_pw",   table: "appeal.appeals",           expectBypass: true },
  { name: "legal",     db: "civitas_legal",     role: "legal_svc",     pw: "legal_dev_pw",     table: "cases.legal_cases",        expectBypass: false },
  { name: "telephony", db: "civitas_telephony", role: "telephony_svc", pw: "telephony_dev_pw", table: "telephony.calls",          expectBypass: false },
];

function dsn(user: string, pw: string, db: string): string {
  return `postgres://${user}:${pw}@${HOST}:${PORT}/${db}`;
}

const openClients: Array<{ end: () => Promise<void> }> = [];
function client(user: string, pw: string, db: string) {
  const c = createSqlClient(dsn(user, pw, db), { max: 2, prepare: false });
  openClients.push(c as unknown as { end: () => Promise<void> });
  return c;
}

afterAll(async () => {
  await Promise.all(openClients.map((c) => c.end().catch(() => {})));
});

describe("Check #3 — RLS enforcement without app.tenant_id GUC (per-service)", () => {
  for (const svc of SERVICES) {
    it(`${svc.name}: role ${svc.role} — BYPASSRLS flag and no-GUC SELECT behaviour`, async () => {
      const admin = client(ADMIN_USER, ADMIN_PW, svc.db);

      // Source of truth: does the runtime role hold BYPASSRLS?
      const roleRows = await admin.unsafe(
        `SELECT rolbypassrls FROM pg_roles WHERE rolname = '${svc.role}'`,
      );
      expect(roleRows.length).toBe(1);
      const bypass = roleRows[0].rolbypassrls === true;

      // Baseline: total rows visible to the superuser-equivalent admin.
      const adminCount = Number(
        (await admin.unsafe(`SELECT count(*)::int AS n FROM ${svc.table}`))[0].n,
      );

      // The actual test: connect AS the service role, NO GUC set, SELECT the table.
      const svcClient = client(svc.role, svc.pw, svc.db);
      const svcCount = Number(
        (await svcClient.unsafe(`SELECT count(*)::int AS n FROM ${svc.table}`))[0].n,
      );

      // eslint-disable-next-line no-console
      console.log(
        `[RLS] ${svc.name.padEnd(10)} role=${svc.role.padEnd(14)} BYPASSRLS=${String(bypass).padEnd(5)} admin_total=${adminCount} svc_noGUC=${svcCount}`,
      );

      // Assert the empirically-known reality holds (regression tripwire).
      expect(bypass).toBe(svc.expectBypass);

      if (bypass) {
        // FINDING: RLS is INERT. Without any GUC the service role sees every
        // tenant's rows. Isolation depends entirely on the app-layer WHERE.
        // Documented as the true current behaviour (see citizen_svc).
        expect(svcCount).toBe(adminCount);
      } else {
        // RLS ENFORCED, fail-closed: no GUC ⇒ zero rows, even though admin
        // can see `adminCount` rows. This is real database-layer isolation.
        expect(svcCount).toBe(0);
      }
    });
  }

  it("summary: at least one sampled service (citizen) has RLS inert via BYPASSRLS (FINDING)", async () => {
    const admin = client(ADMIN_USER, ADMIN_PW, "postgres");
    const rows = await admin.unsafe(
      `SELECT rolname FROM pg_roles WHERE rolname LIKE '%\\_svc' AND rolbypassrls = true ORDER BY rolname`,
    );
    const bypassRoles = rows.map((r: any) => r.rolname as string);
    // eslint-disable-next-line no-console
    console.log(`[RLS] service roles holding BYPASSRLS (RLS inert): ${bypassRoles.join(", ")}`);
    // FINDING: citizen_svc is among them — its RLS is not the enforcer.
    expect(bypassRoles).toContain("citizen_svc");
  });
});
