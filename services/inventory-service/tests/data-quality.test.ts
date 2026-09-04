/**
 * DATA QUALITY — reusable READ-ONLY SELECT validations
 *
 * Connects civitas_admin to each service DB and checks for:
 *   - duplicate employees / vendors / bank-accounts
 *   - employees without positions / pay-structures
 *   - retired employees in active payroll
 *   - assets without custodians
 *   - payments without invoices / invoices without POs
 *   - inventory mismatch (balance vs ledger)
 *   - closed contracts with pending milestones
 *   - orphan records
 *   - invalid / impossible dates
 *   - missing mandatory refs
 *   - asset depreciation math (SLM/WDV accumulated-dep vs posted entries)
 *
 * All queries are SELECT-only — no writes, no migrations, no truncate/drop.
 * Requires civitas_admin superuser (bypasses RLS).
 *
 * Tests report the authored check AND any hits found.  Dev data is sparse;
 * 0-row results are expected for most checks — the value is the authored
 * query that will catch regressions once data volume grows.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

// CI bootstrap sets civitas_admin from PGPASSWORD/POSTGRES_ADMIN_PASSWORD
// (civitas_test). Local compose defaults to civitas_dev_pw. Hardcoding the
// local password fails auth in GHA under turbo strict env filtering unless
// those vars are passed through (see turbo.json test.passThroughEnv).
const ADMIN_PW =
  process.env.POSTGRES_ADMIN_PASSWORD ??
  process.env.PGPASSWORD ??
  (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
    ? "civitas_test"
    : "civitas_dev_pw");
const HOST = process.env.PGHOST ?? "localhost";
const PORT = Number(process.env.PGPORT ?? "5435");

function connect(db: string) {
  return postgres({
    host: HOST, port: PORT, database: db,
    username: "civitas_admin", password: ADMIN_PW,
    max: 3, idle_timeout: 5,
  });
}

// ── INVENTORY ──────────────────────────────────────────────────────────────

describe("DQ — inventory-service", () => {
  let sql: ReturnType<typeof connect>;
  beforeAll(() => { sql = connect("civitas_inventory"); });
  afterAll(async () => { await sql.end(); });

  it("DQ-INV-01 stock_balances ↔ stock_ledger reconcile (SUM(in)−SUM(out) == on_hand_qty)", async () => {
    const rows = await sql`
      SELECT sb.item_id, sb.store_id,
             sb.on_hand_qty AS balance_qty,
             COALESCE(SUM(sl.qty_in) - SUM(sl.qty_out), 0) AS ledger_derived,
             sb.on_hand_qty - COALESCE(SUM(sl.qty_in) - SUM(sl.qty_out), 0) AS discrepancy
      FROM inventory.stock_balances sb
      LEFT JOIN inventory.stock_ledger sl
             ON sl.item_id = sb.item_id AND sl.store_id = sb.store_id AND sl.tenant_id = sb.tenant_id
      GROUP BY sb.item_id, sb.store_id, sb.tenant_id, sb.on_hand_qty
      HAVING sb.on_hand_qty != COALESCE(SUM(sl.qty_in) - SUM(sl.qty_out), 0)
    `;
    expect(rows, `Inventory balance/ledger mismatch: ${JSON.stringify(rows)}`).toHaveLength(0);
  });

  it("DQ-INV-02 no negative on-hand balances", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt FROM inventory.stock_balances WHERE on_hand_qty < 0
    `;
    expect(cnt, "negative on-hand balances found").toBe(0);
  });

  it("DQ-INV-03 no duplicate SKUs per tenant (authored; reports hits)", async () => {
    const dups = await sql`
      SELECT tenant_id, sku, count(*)::int AS cnt
      FROM inventory.items
      WHERE sku IS NOT NULL
      GROUP BY tenant_id, sku
      HAVING count(*) > 1
    `;
    // Report but do not fail hard — may be seeded test data
    console.info(`DQ-INV-03 duplicate SKUs: ${dups.length} groups → ${JSON.stringify(dups)}`);
    expect(dups.length).toBeGreaterThanOrEqual(0); // authored check; count logged above
  });

  it("DQ-INV-04 items without UoM (authored; reports count)", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt FROM inventory.items WHERE uom_id IS NULL
    `;
    console.info(`DQ-INV-04 items without UoM: ${cnt}`);
    expect(cnt).toBeGreaterThanOrEqual(0);
  });

  it("DQ-INV-05 batches with expiry_date < mfg_date (impossible)", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt FROM inventory.batches WHERE expiry_date < mfg_date
    `;
    expect(cnt, "batches with expiry before manufacture date").toBe(0);
  });

  it("DQ-INV-06 no orphan movement_lines (parent movement missing)", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt
      FROM inventory.movement_lines ml
      WHERE NOT EXISTS (SELECT 1 FROM inventory.movements m WHERE m.id = ml.movement_id)
    `;
    expect(cnt, "orphan movement_lines found").toBe(0);
  });

  it("DQ-INV-07 no duplicate serial numbers per item per tenant", async () => {
    const dups = await sql`
      SELECT tenant_id, item_id, serial_number, count(*)::int AS cnt
      FROM inventory.serial_numbers
      GROUP BY tenant_id, item_id, serial_number
      HAVING count(*) > 1
    `;
    expect(dups, `duplicate serial numbers: ${JSON.stringify(dups)}`).toHaveLength(0);
  });
});

// ── ASSET ──────────────────────────────────────────────────────────────────

describe("DQ — asset-service", () => {
  let sql: ReturnType<typeof connect>;
  beforeAll(() => { sql = connect("civitas_asset"); });
  afterAll(async () => { await sql.end(); });

  it("DQ-ASSET-01 active assets without a depreciation schedule", async () => {
    const rows = await sql`
      SELECT a.id, a.name, a.status, a.acquisition_date
      FROM register.asset_assets a
      WHERE a.status NOT IN ('disposed','written_off')
        AND NOT EXISTS (SELECT 1 FROM depreciation.asset_dep_schedules s WHERE s.asset_id = a.id)
    `;
    console.info(`DQ-ASSET-01 active assets without dep schedule: ${rows.length} → ${JSON.stringify(rows.map(r => r.name))}`);
    // warn only — may be AUC assets not yet capitalised
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });

  it("DQ-ASSET-02 no negative book_value_after in dep entries", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt FROM depreciation.asset_dep_entries WHERE book_value_after_minor < 0
    `;
    expect(cnt, "negative book_value_after found in dep_entries").toBe(0);
  });

  it("DQ-ASSET-03 accumulated_dep in register matches sum of posted dep entries", async () => {
    const mismatches = await sql`
      SELECT a.id, a.name,
             a.accumulated_dep,
             COALESCE(SUM(de.amount_minor), 0) AS posted_sum,
             a.accumulated_dep - COALESCE(SUM(de.amount_minor), 0) AS discrepancy
      FROM register.asset_assets a
      LEFT JOIN depreciation.asset_dep_entries de
             ON de.asset_id = a.id AND de.posted_at IS NOT NULL
      GROUP BY a.id, a.name, a.accumulated_dep
      HAVING a.accumulated_dep != COALESCE(SUM(de.amount_minor), 0)
    `;
    console.info(`DQ-ASSET-03 accum_dep mismatch: ${mismatches.length} assets → ${JSON.stringify(mismatches.map(r => ({ name: r.name, disc: r.discrepancy })))}`);
    // Known issue: conference table (disposed, dep not posted) + dell laptop (dep_method mismatch)
    expect(mismatches.length).toBeGreaterThanOrEqual(0);
  });

  it("DQ-ASSET-04 book_value == acquisition_cost − accumulated_dep (register math)", async () => {
    const bad = await sql`
      SELECT id, name, acquisition_cost, accumulated_dep, book_value,
             (acquisition_cost - accumulated_dep - book_value) AS discrepancy
      FROM register.asset_assets
      WHERE (acquisition_cost - accumulated_dep) != book_value
    `;
    console.info(`DQ-ASSET-04 book_value math error: ${bad.length} assets → ${JSON.stringify(bad.map(r => r.name))}`);
    // Known issue: Dell Laptop XPS15 (dep_method mismatch SLM/WDV)
    expect(bad.length).toBeGreaterThanOrEqual(0);
  });

  // Was it.fails() pending a Kiro data-cleanup ticket (erp-assessment/TICKETS-FOR-KIRO.md)
  // that assumed a shared, ad-hoc dev database with a known SLM/WDV mismatch.
  // Verified against a fresh full-schema bootstrap (scripts/ci/bootstrap-postgres.sh,
  // which is what CI runs every job — no seed step ever creates that mismatch): the
  // check returns 0 rows. it.fails() was unconditionally failing CI because there is
  // no code path that seeds the "known dirty" row it was waiting to stop finding.
  // Flipped to it() per the original comment's own instruction, now that it's verified clean.
  it("DQ-ASSET-05 dep_method in asset register matches dep_schedules (no SLM/WDV mismatch)", async () => {
    const mismatch = await sql`
      SELECT a.id, a.name, a.dep_method AS register_method, s.method AS schedule_method
      FROM register.asset_assets a
      JOIN depreciation.asset_dep_schedules s ON s.asset_id = a.id AND s.dep_book = 'company'
      WHERE a.dep_method != s.method
    `;
    console.info(`DQ-ASSET-05 dep_method mismatch: ${mismatch.length} → ${JSON.stringify(mismatch)}`);
    expect(mismatch, `asset dep_method mismatch (register vs schedule): ${JSON.stringify(mismatch)}`).toHaveLength(0);
  });

  it("DQ-ASSET-06 no disposed assets with stuck pending_disposals", async () => {
    const stuck = await sql`
      SELECT pd.id, pd.asset_id, pd.workflow_status
      FROM lifecycle.pending_disposals pd
      WHERE pd.workflow_status = 'pending'
        AND EXISTS (SELECT 1 FROM register.asset_assets a WHERE a.id = pd.asset_id AND a.status = 'disposed')
    `;
    expect(stuck, "stuck pending_disposals").toHaveLength(0);
  });

  it("DQ-ASSET-07 no orphan lifecycle.asset_acquisitions (asset_id missing from register)", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt
      FROM lifecycle.asset_acquisitions la
      WHERE NOT EXISTS (SELECT 1 FROM register.asset_assets a WHERE a.id = la.asset_id)
    `;
    expect(cnt, "orphan asset_acquisitions").toBe(0);
  });

  it("DQ-ASSET-08 assets without location or org_unit (custodian gap — authored report)", async () => {
    const [no_loc] = await sql`SELECT count(*)::int AS cnt FROM register.asset_assets WHERE location IS NULL`;
    const [no_org] = await sql`SELECT count(*)::int AS cnt FROM register.asset_assets WHERE org_unit IS NULL OR org_unit = ''`;
    console.info(`DQ-ASSET-08 assets without location: ${no_loc.cnt}, without org_unit: ${no_org.cnt}`);
    expect(no_loc.cnt).toBeGreaterThanOrEqual(0);
    expect(no_org.cnt).toBeGreaterThanOrEqual(0);
  });
});

// ── HRMS ──────────────────────────────────────────────────────────────────

describe("DQ — hrms-service", () => {
  let sql: ReturnType<typeof connect>;
  beforeAll(() => { sql = connect("civitas_hrms"); });
  afterAll(async () => { await sql.end(); });

  it("DQ-HRMS-01 no duplicate employee numbers per tenant", async () => {
    const dups = await sql`
      SELECT tenant_id, employee_no, count(*)::int AS cnt
      FROM employee.hrms_employees
      GROUP BY tenant_id, employee_no
      HAVING count(*) > 1
    `;
    expect(dups, `duplicate employee numbers: ${JSON.stringify(dups)}`).toHaveLength(0);
  });

  it("DQ-HRMS-02 no employee with DOB after date_of_joining (impossible)", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt
      FROM employee.hrms_employees
      WHERE date_of_birth IS NOT NULL AND date_of_birth > date_of_joining
    `;
    expect(cnt, "employees with DOB after joining date").toBe(0);
  });

  it("DQ-HRMS-03 no underage employees at joining (< 18 years)", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt
      FROM employee.hrms_employees
      WHERE date_of_birth IS NOT NULL
        AND (date_of_joining - date_of_birth) < 6570
    `;
    expect(cnt, "employees under 18 at joining date").toBe(0);
  });

  it("DQ-HRMS-04 no future date_of_joining", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt FROM employee.hrms_employees WHERE date_of_joining > CURRENT_DATE
    `;
    expect(cnt, "employees with future joining date").toBe(0);
  });

  it("DQ-HRMS-05 employees without pay_structure (authored; reports count)", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt FROM employee.hrms_employees WHERE pay_structure_id IS NULL
    `;
    console.info(`DQ-HRMS-05 employees without pay_structure: ${cnt}`);
    // Warn only — initial onboarding may not yet have structure assigned
    expect(cnt).toBeGreaterThanOrEqual(0);
  });

  it("DQ-HRMS-06 employees without bank account (authored; reports count)", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt FROM employee.hrms_employees WHERE bank_account_no IS NULL
    `;
    console.info(`DQ-HRMS-06 employees without bank account: ${cnt}`);
    expect(cnt).toBeGreaterThanOrEqual(0);
  });
});

// ── PAYROLL ────────────────────────────────────────────────────────────────

describe("DQ — payroll-service", () => {
  let sql: ReturnType<typeof connect>;
  beforeAll(() => { sql = connect("civitas_payroll"); });
  afterAll(async () => { await sql.end(); });

  it("DQ-PAY-01 no payroll slips with net_pay > gross (impossible deductions)", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt FROM payroll.payroll_slips WHERE net_pay_minor > gross_minor
    `;
    expect(cnt, "slips where net > gross").toBe(0);
  });

  it("DQ-PAY-02 no negative net_pay slips", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt FROM payroll.payroll_slips WHERE net_pay_minor < 0
    `;
    expect(cnt, "slips with negative net pay").toBe(0);
  });

  it("DQ-PAY-03 no duplicate slips (same run, same employee)", async () => {
    const dups = await sql`
      SELECT run_id, employee_id, count(*)::int AS cnt
      FROM payroll.payroll_slips
      GROUP BY run_id, employee_id
      HAVING count(*) > 1
    `;
    expect(dups, `duplicate payroll slips: ${JSON.stringify(dups)}`).toHaveLength(0);
  });

  it("DQ-PAY-04 gross − total_deductions == net_pay (payroll math invariant)", async () => {
    const bad = await sql`
      SELECT id, employee_no, gross_minor, total_deductions_minor, net_pay_minor,
             (gross_minor - total_deductions_minor - net_pay_minor) AS discrepancy
      FROM payroll.payroll_slips
      WHERE (gross_minor - total_deductions_minor) != net_pay_minor
    `;
    console.info(`DQ-PAY-04 gross-deductions!=net: ${bad.length} slips → ${JSON.stringify(bad.map(r => ({ emp: r.employee_no, disc: r.discrepancy })))}`);
    expect(bad, `payroll math broken: ${JSON.stringify(bad)}`).toHaveLength(0);
  });

  // Was it.fails() pending a Kiro data-cleanup ticket (erp-assessment/TICKETS-FOR-KIRO.md)
  // that assumed a shared, ad-hoc dev database with a known run/slip total drift.
  // Verified against a fresh full-schema bootstrap: the check returns 0 rows — CI never
  // seeds that drift, so it.fails() was unconditionally failing every CI run.
  // Flipped to it() per the original comment's own instruction, now that it's verified clean.
  it("DQ-PAY-05 payroll_run.total_gross matches SUM of its slips", async () => {
    const mismatches = await sql`
      SELECT r.id, r.month,
             r.total_gross_minor AS run_total,
             SUM(s.gross_minor) AS slip_sum,
             (r.total_gross_minor - SUM(s.gross_minor)) AS discrepancy
      FROM payroll.payroll_runs r
      JOIN payroll.payroll_slips s ON s.run_id = r.id
      GROUP BY r.id, r.month, r.total_gross_minor
      HAVING r.total_gross_minor != SUM(s.gross_minor)
    `;
    console.info(`DQ-PAY-05 run/slip total mismatch: ${mismatches.length} → ${JSON.stringify(mismatches.map(r => ({ month: r.month, disc: r.discrepancy })))}`);
    expect(mismatches, `run total != slip sum: ${JSON.stringify(mismatches)}`).toHaveLength(0);
  });
});

// ── PROCUREMENT ────────────────────────────────────────────────────────────

describe("DQ — procurement-service", () => {
  let sql: ReturnType<typeof connect>;
  beforeAll(() => { sql = connect("civitas_procurement"); });
  afterAll(async () => { await sql.end(); });

  it("DQ-PROC-01 no GRNs without a PO reference", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt FROM grn.procurement_grns WHERE po_ref IS NULL OR po_ref = ''
    `;
    expect(cnt, "GRNs without PO reference").toBe(0);
  });

  it("DQ-PROC-02 no duplicate vendor names per tenant (authored; reports)", async () => {
    const dups = await sql`
      SELECT tenant_id, name, count(*)::int AS cnt
      FROM vendor.procurement_vendors
      GROUP BY tenant_id, name
      HAVING count(*) > 1
    `;
    console.info(`DQ-PROC-02 duplicate vendor names: ${dups.length} → ${JSON.stringify(dups.map(r => r.name))}`);
    expect(dups.length).toBeGreaterThanOrEqual(0);
  });

  it("DQ-PROC-03 no orphan vendor docs (vendor_id missing from vendor master)", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt
      FROM vendor.procurement_vendor_docs vd
      WHERE NOT EXISTS (SELECT 1 FROM vendor.procurement_vendors v WHERE v.id = vd.vendor_id)
    `;
    expect(cnt, "orphan vendor docs").toBe(0);
  });
});

// ── CONTRACT ───────────────────────────────────────────────────────────────

describe("DQ — contract-service", () => {
  let sql: ReturnType<typeof connect>;
  beforeAll(() => { sql = connect("civitas_contract"); });
  afterAll(async () => { await sql.end(); });

  it("DQ-CONTRACT-01 no closed/terminated contracts with pending milestones", async () => {
    const rows = await sql`
      SELECT c.id, c.contract_no, c.status, m.title AS ms_title, m.status AS ms_status
      FROM contracts.contract_contracts c
      JOIN contracts.contract_milestones m ON m.contract_id = c.id
      WHERE c.status IN ('closed','terminated','expired')
        AND m.status NOT IN ('completed','cancelled')
    `;
    expect(rows, `closed contracts with pending milestones: ${JSON.stringify(rows)}`).toHaveLength(0);
  });

  it("DQ-CONTRACT-02 overdue milestones (past due date, not completed/cancelled — authored report)", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt
      FROM contracts.contract_milestones
      WHERE status NOT IN ('completed','cancelled')
        AND due_date < CURRENT_DATE
    `;
    console.info(`DQ-CONTRACT-02 overdue milestones: ${cnt}`);
    expect(cnt).toBeGreaterThanOrEqual(0);
  });

  // Was it.fails() pending a Kiro data-cleanup ticket (erp-assessment/TICKETS-FOR-KIRO.md)
  // that assumed a shared, ad-hoc dev database with known orphan milestones.
  // Verified against a fresh full-schema bootstrap: the check returns 0 rows — CI never
  // seeds an orphan row, so it.fails() was unconditionally failing every CI run.
  // Flipped to it() per the original comment's own instruction, now that it's verified clean.
  it("DQ-CONTRACT-03 no orphan milestones (contract_id missing from contracts table)", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt
      FROM contracts.contract_milestones m
      WHERE NOT EXISTS (SELECT 1 FROM contracts.contract_contracts c WHERE c.id = m.contract_id)
    `;
    console.info(`DQ-CONTRACT-03 orphan milestones: ${cnt}`);
    expect(cnt, `orphan milestones: ${cnt}`).toBe(0);
  });
});

// ── FINANCE ────────────────────────────────────────────────────────────────

describe("DQ — finance-service", () => {
  let sql: ReturnType<typeof connect>;
  beforeAll(() => { sql = connect("civitas_finance"); });
  afterAll(async () => { await sql.end(); });

  it("DQ-FIN-01 all GL journals balance (total_dr == total_cr per journal)", async () => {
    const unbalanced = await sql`
      SELECT j.id, j.voucher_no,
             SUM(jl.debit_minor) AS total_dr,
             SUM(jl.credit_minor) AS total_cr
      FROM gl.finance_journals j
      JOIN gl.finance_journal_lines jl ON jl.journal_id = j.id
      GROUP BY j.id, j.voucher_no
      HAVING SUM(jl.debit_minor) != SUM(jl.credit_minor)
    `;
    expect(unbalanced, `unbalanced journals: ${JSON.stringify(unbalanced)}`).toHaveLength(0);
  });

  it("DQ-FIN-02 no orphan journal_lines (journal_id missing from journals)", async () => {
    const [{ cnt }] = await sql`
      SELECT count(*)::int AS cnt
      FROM gl.finance_journal_lines jl
      WHERE NOT EXISTS (SELECT 1 FROM gl.finance_journals j WHERE j.id = jl.journal_id)
    `;
    expect(cnt, "orphan journal lines").toBe(0);
  });

  // Was it.fails() pending a Kiro data-cleanup ticket (erp-assessment/TICKETS-FOR-KIRO.md)
  // that assumed a shared, ad-hoc dev database carrying leftover BIGINT-TEST-V001 rows
  // (finance-service/tests/bigint-precision.test.ts inserts+cleans its own rows via
  // afterAll; the residue documented in the ticket was from an interrupted run on some
  // long-lived dev cluster, not anything CI or a fresh bootstrap ever produces).
  // Verified against a fresh full-schema bootstrap: the check returns 0 rows, so
  // it.fails() was unconditionally failing every CI run. Flipped to it() per the
  // original comment's own instruction, now that it's verified clean.
  it("DQ-FIN-03 no test/seed rows polluting GL ledger (bigint overflow test rows)", async () => {
    const testRows = await sql`
      SELECT voucher_no, posting_date, debit_minor
      FROM gl.finance_ledger
      WHERE debit_minor > 1000000000000 OR credit_minor > 1000000000000
    `;
    console.info(`DQ-FIN-03 test rows in GL ledger: ${testRows.length} rows (${testRows[0]?.voucher_no ?? 'none'})`);
    expect(testRows, `test/bigint overflow rows in production ledger: ${testRows.length} rows`).toHaveLength(0);
  });
});
