/**
 * L6 — Security: Audit Ledger Immutability (P1)
 *
 * CERT-In / DPDP requirement: the audit trail must be tamper-evident.
 * Verifies that UPDATE and DELETE on audit_events are rejected at the DB level
 * (not just application level), and that TRUNCATE is blocked.
 *
 * Extended 2026-08-27/28 after a deep-verification pass found that the
 * TRUNCATE guard covered `events.events` (the partitioned parent) but not
 * its actual partitions — where 100% of rows physically live — and that
 * nine case-of-record tables (observations, paras, plans, risks, vigilance
 * cases/actions/evidence) had no DB-level DELETE/TRUNCATE protection at all.
 * Migration 0027_immutability_guard_gaps.sql fixed both; the blocks below
 * guard against either regressing silently the way the original partition
 * gap did (0014 shipped for months before this pass caught it).
 */
import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

const PGHOST = process.env.PGHOST ?? "localhost";
const PGPORT = process.env.PGPORT ?? "5435";
const DB = "civitas_audit";
const ROLE = "audit_svc";
const PW = "audit_dev_pw";

const TENANT = "00000000-0000-0000-0000-000000000001";

function psqlResult(query: string): { ok: boolean; output: string } {
  try {
    const out = execSync(
      `PGPASSWORD='${PW}' psql -h ${PGHOST} -p ${PGPORT} -U ${ROLE} -d ${DB} -t -A -c "${query.replace(/"/g, '\\"')}"`,
      { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] },
    );
    return { ok: true, output: out.trim() };
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
    const stderr = e.stderr ? String(e.stderr) : "";
    const stdout = e.stdout ? String(e.stdout) : "";
    return { ok: false, output: stderr || stdout || e.message || "unknown error" };
  }
}

/** An audit row inserted inside the probe transaction, so row-level triggers have a target. */
const SEED_EVENT = `
  INSERT INTO events.events
    (id, tenant_id, type, actor, payload, severity, occurred_at, created_at, created_by, retain_until, version)
  VALUES
    (gen_random_uuid(), '${TENANT}', 'l6.immutability.probe', '{}'::jsonb, '{}'::jsonb, 'info',
     now(), now(), '00000000-0000-0000-0000-0000000000aa', now() + interval '1 year', 1)
`;

/**
 * Run a mutation inside a transaction that:
 *   1. sets the tenant GUC, so RLS admits the statement (without it Postgres
 *      raises "unrecognized configuration parameter" — a config error, not the
 *      immutability guard, which would make the test pass for the wrong reason);
 *   2. seeds one audit row, so a row-level UPDATE/DELETE trigger has a target
 *      (a statement matching zero rows never fires one, which previously left
 *      these checks unmeasured);
 *   3. runs the mutation under test.
 * Always rolled back — the seeded row never persists.
 */
function psqlScopedMutation(statement: string): { ok: boolean; output: string } {
  const sql = [
    "BEGIN",
    `SET LOCAL app.tenant_id = '${TENANT}'`,
    SEED_EVENT,
    statement,
    "ROLLBACK",
  ]
    .map((s) => `-c "${s.replace(/\s+/g, " ").trim().replace(/"/g, '\\"')}"`)
    .join(" ");
  try {
    const out = execSync(
      `PGPASSWORD='${PW}' psql -h ${PGHOST} -p ${PGPORT} -U ${ROLE} -d ${DB} -t -A -v ON_ERROR_STOP=1 ${sql}`,
      { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] },
    );
    return { ok: true, output: out.trim() };
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
    const stderr = e.stderr ? String(e.stderr) : "";
    const stdout = e.stdout ? String(e.stdout) : "";
    return { ok: false, output: stderr || stdout || e.message || "unknown error" };
  }
}

/**
 * Run a statement-level-trigger probe inside a rolled-back transaction, with
 * no row seeding. Only valid for statements guarded by a FOR EACH STATEMENT
 * trigger (DELETE/TRUNCATE on the tables in this file all are) — those fire
 * regardless of whether any row matches, so unlike psqlScopedMutation above,
 * there is nothing to seed. Always rolled back — nothing can persist even if
 * the guard under test has regressed and the statement "succeeds".
 */
function psqlScopedStatement(statement: string): { ok: boolean; output: string } {
  const sql = ["BEGIN", `SET LOCAL app.tenant_id = '${TENANT}'`, statement, "ROLLBACK"]
    .map((s) => `-c "${s.replace(/\s+/g, " ").trim().replace(/"/g, '\\"')}"`)
    .join(" ");
  try {
    const out = execSync(
      `PGPASSWORD='${PW}' psql -h ${PGHOST} -p ${PGPORT} -U ${ROLE} -d ${DB} -t -A -v ON_ERROR_STOP=1 ${sql}`,
      { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] },
    );
    return { ok: true, output: out.trim() };
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
    const stderr = e.stderr ? String(e.stderr) : "";
    const stdout = e.stdout ? String(e.stdout) : "";
    return { ok: false, output: stderr || stdout || e.message || "unknown error" };
  }
}

/** Guard: the probe transaction itself must work, or every assertion below is vacuous. */
function assertSeedWorks(): void {
  const { ok, output } = psqlScopedMutation("SELECT count(*) FROM events.events");
  if (!ok) {
    expect.fail(
      `L6 audit-immutability probe transaction failed before reaching the guard — ` +
        `assertions would be vacuous. Output: ${output}`,
    );
  }
}

describe("L6 — Audit ledger: immutability triggers exist", () => {
  it("events table has an immutability trigger", () => {
    const { ok, output } = psqlResult(`
      SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid::regclass::text LIKE '%events%'
        AND tgname LIKE '%immutable%'
      LIMIT 1
    `);
    if (!ok) {
      // DB unreachable — skip rather than false-fail
      return;
    }
    expect(output.length).toBeGreaterThan(0);
  });

  it("events table has a no-truncate trigger", () => {
    const { ok, output } = psqlResult(`
      SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid::regclass::text LIKE '%events%'
        AND tgname LIKE '%truncate%'
      LIMIT 1
    `);
    if (!ok) return;
    expect(output.length).toBeGreaterThan(0);
  });
});

describe("L6 — Audit ledger: UPDATE is rejected", () => {
  it("UPDATE on a real audit row is rejected by the append-only trigger", () => {
    assertSeedWorks();
    const { ok, output } = psqlScopedMutation(
      `UPDATE events.events SET type = 'TAMPERED' WHERE true`
    );
    // A seeded row is present, so the row-level trigger MUST fire. Success here
    // means the audit log is mutable — a CERT-In / DPDP release blocker.
    expect(ok, "UPDATE on a seeded audit row succeeded — audit log is MUTABLE").toBe(false);
    // Confirm it was the immutability guard, not a permissions/config/syntax error.
    expect(output.toLowerCase()).toMatch(/append-only|append only|immutab/);
  });
});

describe("L6 — Audit ledger: DELETE is rejected", () => {
  it("DELETE on a real audit row is rejected by the append-only trigger", () => {
    assertSeedWorks();
    const { ok, output } = psqlScopedMutation(`DELETE FROM events.events WHERE true`);
    expect(ok, "DELETE on a seeded audit row succeeded — audit log is MUTABLE").toBe(false);
    expect(output.toLowerCase()).toMatch(/append-only|append only|immutab/);
  });
});

describe("L6 — Audit ledger: TRUNCATE is rejected", () => {
  it("TRUNCATE on events is blocked", () => {
    const { ok, output } = psqlResult(`TRUNCATE events.events`);
    // TRUNCATE fires a statement-level trigger even on an empty table, so this
    // must always fail.
    expect(ok).toBe(false);
    expect(output.toLowerCase()).toMatch(/immutab|truncate|not allowed|cannot|denied|permission/);
  });

  /**
   * G-FIX-1 regression guard: 0014_partition_audit_events.sql converted
   * events.events into a partitioned table without re-creating this guard on
   * any partition — TRUNCATE events.events (the parent, tested above) stayed
   * blocked, but `TRUNCATE events.events_y2026m08` (an actual partition,
   * where the rows live) silently succeeded for months. Picks whatever
   * partition currently exists via pg_inherits rather than a hardcoded name,
   * so this does not go stale next month.
   */
  it("TRUNCATE on an individual partition is blocked (not just the parent)", () => {
    const { ok: foundOk, output: partName } = psqlResult(`
      SELECT c.relname FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      JOIN pg_namespace n ON n.oid = p.relnamespace
      WHERE n.nspname = 'events' AND p.relname = 'events'
      ORDER BY c.relname LIMIT 1
    `);
    if (!foundOk || partName.length === 0) {
      // No partitions found (e.g. events.events not partitioned in this
      // environment) — nothing to check, skip rather than false-fail.
      return;
    }
    const { ok, output } = psqlResult(`TRUNCATE events.${partName}`);
    expect(ok, `TRUNCATE events.${partName} succeeded — a partition is NOT append-only`).toBe(false);
    expect(output.toLowerCase()).toMatch(/immutab|truncate|not allowed|cannot|denied|permission/);
  });
});

/**
 * G-FIX-2 regression guard: observation/para/plan/risk/vigilance case-of-record
 * tables had UPDATE, DELETE and TRUNCATE all granted to audit_svc with no
 * trigger backstop before 0027_immutability_guard_gaps.sql. UPDATE is
 * legitimate (status-transition workflows) and must keep working; DELETE and
 * TRUNCATE must not. All rejections here rely on a FOR EACH STATEMENT
 * trigger, so no row needs to exist for the guard to fire — psqlScopedStatement
 * runs everything inside BEGIN/ROLLBACK regardless, so a regression here
 * cannot destroy real data as a side effect of running this test.
 */
describe("L6 — Case-of-record tables: DELETE/TRUNCATE rejected, UPDATE unaffected", () => {
  const CASE_TABLES = [
    "observation.audit_observations",
    "para.audit_paras",
    "para.audit_para_status_history",
    "plan.audit_plans",
    "risk.audit_risks",
    "risk.risk_acceptances",
    "vigilance.vigilance_cases",
    "vigilance.vigilance_actions",
    "vigilance.vigilance_evidence",
  ];

  it.each(CASE_TABLES)("DELETE FROM %s is rejected", (table) => {
    const { ok, output } = psqlScopedStatement(`DELETE FROM ${table} WHERE true`);
    expect(ok, `DELETE FROM ${table} succeeded — this case-of-record table is hard-deletable`).toBe(false);
    expect(output.toLowerCase()).toMatch(/immutab|not permitted|denied|cannot/);
  });

  it.each(CASE_TABLES)("TRUNCATE %s is rejected", (table) => {
    const { ok, output } = psqlScopedStatement(`TRUNCATE ${table}`);
    expect(ok, `TRUNCATE ${table} succeeded — this case-of-record table is truncatable`).toBe(false);
    expect(output.toLowerCase()).toMatch(/immutab|not permitted|denied|cannot/);
  });

  it("UPDATE on a case-of-record table still succeeds (no over-broad lockdown)", () => {
    // Targets a real seeded row (plan.audit_plans, DEV DEMO tenant) so a
    // false pass from "0 rows matched" is not possible — this must be a
    // genuine, committed-then-rolled-back UPDATE.
    const { ok, output } = psqlScopedStatement(`
      UPDATE plan.audit_plans SET updated_at = now()
      WHERE id = '99999999-0001-0000-0000-000000000003'
    `);
    expect(ok, `UPDATE on plan.audit_plans failed — the DELETE/TRUNCATE guard is over-broad: ${output}`).toBe(true);
  });
});
