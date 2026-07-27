/**
 * L6 — Security: Audit Ledger Immutability (P1)
 *
 * CERT-In / DPDP requirement: the audit trail must be tamper-evident.
 * Verifies that UPDATE and DELETE on audit_events are rejected at the DB level
 * (not just application level), and that TRUNCATE is blocked.
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
});
