/**
 * L3 — Data & Schema Integrity Gate (P0)
 *
 * Verifies against the LIVE databases:
 *  1. No float/numeric money columns (money must be bigint minor units)
 *  2. Every timestamp column is timestamptz
 *  3. No service role holds BYPASSRLS
 *  4. GL double-entry invariant: sum(debit) = sum(credit) per journal
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HONESTY REPAIR 2026-07-27 — this lane was largely vacuous. Three defects, all
 * of which made it report a pass while verifying nothing:
 *
 *  D1  `psql()` returned the sentinel "__DB_ERROR__" on ANY failure and every
 *      caller did `if (result === "__DB_ERROR__") return;` — a silent pass. A
 *      wrong password, a missing table or a dead server all read as "clean".
 *
 *  D2  Hidden by D1: the BYPASSRLS check connected with password
 *      `civitas_admin_dev_pw`. The real password is `civitas_dev_pw`, so it
 *      failed authentication on every run and the security check NEVER
 *      executed. Visible in the run output as
 *      `FATAL: password authentication failed for user "civitas_admin"`
 *      immediately above a green result.
 *
 *  D3  Hidden by D1: the double-entry check queried `finance.journal_lines`.
 *      That relation does not exist — the table is `gl.finance_journal_lines`.
 *      The platform's single most important financial invariant had never once
 *      been evaluated. Visible in the run output as
 *      `ERROR: relation "finance.journal_lines" does not exist`.
 *
 *  D4  The timestamptz check only called `console.warn` on violations, so it
 *      could not fail regardless of what it found.
 *
 * Repairs: psql() now returns a discriminated result and every DB failure fails
 * the test as UNMEASURED; credentials and table names are resolved rather than
 * assumed; the timestamptz check asserts; and the double-entry detector is
 * proven non-vacuous by a planted-imbalance canary inside a rolled-back
 * transaction (the table is empty in dev, so a bare "no imbalance found" would
 * itself be vacuous).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";

const PGHOST = process.env.PGHOST ?? "localhost";
const PGPORT = process.env.PGPORT ?? "5435";
const ADMIN_USER = process.env.POSTGRES_ADMIN_USER ?? "civitas_admin";
// D2: was hardcoded to a password that does not exist.
const ADMIN_PW = process.env.POSTGRES_ADMIN_PASSWORD ?? "civitas_dev_pw";

const TEST_TENANT = "00000000-0000-0000-0000-000000000001";

interface ServiceDb {
  name: string;
  db: string;
  role: string;
  pw: string;
}

const SERVICE_DBS: ServiceDb[] = [
  "finance",
  "hrms",
  "payroll",
  "procurement",
  "citizen",
  "legal",
  "asset",
  "stock",
  "project",
  "grant",
  "crm",
  "contract",
  "estab",
  "audit",
  "workflow",
  "identity",
  "admin",
  "analytics",
].map((name) => ({ name, db: `civitas_${name}`, role: `${name}_svc`, pw: `${name}_dev_pw` }));

type PsqlResult = { ok: true; out: string } | { ok: false; err: string };

/**
 * Run SQL and distinguish "query succeeded and returned nothing" from "the query
 * or the connection failed". Conflating those two is defect D1 above.
 *
 * execFileSync with an argv array, not a shell string: the previous version
 * interpolated the password and the query into a shell command.
 */
function psql(db: string, user: string, pw: string, query: string): PsqlResult {
  try {
    const out = execFileSync(
      "psql",
      ["-h", PGHOST, "-p", PGPORT, "-U", user, "-d", db, "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", query],
      { encoding: "utf-8", timeout: 15000, env: { ...process.env, PGPASSWORD: pw } },
    );
    return { ok: true, out: out.trim() };
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString() ?? "");
    return { ok: false, err: (stderr || err.message || "unknown psql failure").trim() };
  }
}

/** Fail the test rather than skip it. A lane that cannot measure has not passed. */
function requireOk(r: PsqlResult, what: string): string {
  if (r.ok === false) {
    expect.fail(
      `UNMEASURED — ${what} could not be evaluated, so this is NOT a pass.\n` +
        `  psql said: ${r.err.split("\n").slice(0, 3).join(" | ")}`,
    );
  }
  return r.out;
}

describe("L3 — Preflight: every configured database is reachable", () => {
  it("all service databases answer with their configured role", () => {
    const dead: string[] = [];
    for (const svc of SERVICE_DBS) {
      const r = psql(svc.db, svc.role, svc.pw, "SELECT 1");
      if (r.ok === false || r.out !== "1") {
        dead.push(`${svc.name} (${svc.role}@${svc.db}): ${r.ok ? `unexpected output "${r.out}"` : r.err.split("\n")[0]}`);
      }
    }
    if (dead.length > 0) {
      expect.fail(
        `UNMEASURED — ${dead.length}/${SERVICE_DBS.length} database(s) unreachable, so their\n` +
          `integrity checks below verify nothing:\n  ${dead.join("\n  ")}`,
      );
    }
  });

  it("admin credentials work (the check that silently never ran)", () => {
    const out = requireOk(
      psql("postgres", ADMIN_USER, ADMIN_PW, "SELECT current_user"),
      `admin connection as ${ADMIN_USER}`,
    );
    expect(out).toBe(ADMIN_USER);
  });
});

describe("L3 — Money columns: no float/real/double/numeric money columns", () => {
  for (const svc of SERVICE_DBS) {
    it(`${svc.name}: money columns are bigint (not float/numeric)`, () => {
      const out = requireOk(
        psql(
          svc.db,
          svc.role,
          svc.pw,
          `SELECT table_schema || '.' || table_name || '.' || column_name || ' (' || data_type || ')'
             FROM information_schema.columns
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
              AND (column_name ILIKE '%amount%' OR column_name ILIKE '%price%'
                   OR column_name ILIKE '%cost%' OR column_name ILIKE '%salary%'
                   OR column_name ILIKE '%gross%' OR column_name ILIKE '%net%'
                   OR column_name ILIKE '%debit%' OR column_name ILIKE '%credit%'
                   OR column_name ILIKE '%balance%' OR column_name ILIKE '%paise%'
                   OR column_name ILIKE '%minor%' OR column_name ILIKE '%fee%')
              AND data_type IN ('real', 'double precision', 'numeric', 'decimal', 'money')
              AND column_name NOT IN ('fee_pct', 'credit_hours')`,
        ),
        `${svc.name} money column types`,
      );
      if (out !== "") {
        expect.fail(`${svc.name} has float/numeric money columns:\n  ${out.split("\n").join("\n  ")}`);
      }
    });
  }
});

describe("L3 — Timestamp columns: must be timestamptz", () => {
  for (const svc of SERVICE_DBS) {
    // D4: this used to console.warn and pass unconditionally. Measured at zero
    // violations across all 18 databases on 2026-07-27, so it asserts now.
    it(`${svc.name}: no 'timestamp without time zone'`, () => {
      const out = requireOk(
        psql(
          svc.db,
          svc.role,
          svc.pw,
          `SELECT table_schema || '.' || table_name || '.' || column_name
             FROM information_schema.columns
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
              AND data_type = 'timestamp without time zone'
            ORDER BY 1 LIMIT 25`,
        ),
        `${svc.name} timestamp column types`,
      );
      if (out !== "") {
        expect.fail(
          `${svc.name} has ${out.split("\n").length} non-timestamptz column(s):\n  ` +
            out.split("\n").join("\n  "),
        );
      }
    });
  }
});

describe("L3 — RLS / BYPASSRLS audit", () => {
  it("the BYPASSRLS predicate actually matches rows (detector canary)", () => {
    // Without this, an empty result is indistinguishable from a broken query.
    // Inverting the predicate must return roles; if it does not, the column or
    // the LIKE filter is wrong and the real assertion below means nothing.
    const out = requireOk(
      psql(
        "postgres",
        ADMIN_USER,
        ADMIN_PW,
        `SELECT rolname FROM pg_roles WHERE rolname LIKE '%\\_svc' AND rolbypassrls = false ORDER BY 1 LIMIT 5`,
      ),
      "BYPASSRLS detector canary",
    );
    expect(
      out.split("\n").filter(Boolean).length,
      "no '%_svc' roles matched at all — the BYPASSRLS audit below is vacuous",
    ).toBeGreaterThan(0);
  });

  it("no service roles have BYPASSRLS", () => {
    const out = requireOk(
      psql(
        "postgres",
        ADMIN_USER,
        ADMIN_PW,
        `SELECT rolname FROM pg_roles WHERE rolname LIKE '%\\_svc' AND rolbypassrls = true ORDER BY 1`,
      ),
      "service role BYPASSRLS audit",
    );
    if (out !== "") {
      expect.fail(`Service roles with BYPASSRLS (RLS is bypassable — tenant isolation void):\n  ${out}`);
    }
  });
});

describe("L3 — Double-entry invariant (finance GL)", () => {
  const FIN = SERVICE_DBS.find((s) => s.name === "finance") as ServiceDb;

  /**
   * D3: the old test named `finance.journal_lines`, which does not exist.
   * Resolve the relation from the catalogue instead of hardcoding a guess, and
   * fail if it is absent — a missing GL table is itself a P0 finding.
   */
  function resolveJournalLines(): string {
    const out = requireOk(
      psql(
        FIN.db,
        FIN.role,
        FIN.pw,
        `SELECT c.table_schema || '.' || c.table_name
           FROM information_schema.columns c
          WHERE c.column_name = 'debit_minor'
            AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
            AND EXISTS (SELECT 1 FROM information_schema.columns c2
                         WHERE c2.table_schema = c.table_schema
                           AND c2.table_name = c.table_name
                           AND c2.column_name = 'credit_minor')
            AND EXISTS (SELECT 1 FROM information_schema.columns c3
                         WHERE c3.table_schema = c.table_schema
                           AND c3.table_name = c.table_name
                           AND c3.column_name = 'journal_id')
          ORDER BY 1 LIMIT 1`,
      ),
      "GL journal-lines table resolution",
    );
    if (out === "") {
      expect.fail(
        "No GL journal-lines table found in civitas_finance (needs debit_minor,\n" +
          "credit_minor and journal_id). The double-entry invariant cannot be checked.",
      );
    }
    return out;
  }

  it("the GL journal-lines table exists and is queryable", () => {
    const rel = resolveJournalLines();
    expect(rel).toMatch(/^[a-z_]+\.[a-z_]+$/);
    const cols = requireOk(
      psql(
        FIN.db,
        FIN.role,
        FIN.pw,
        `SELECT data_type FROM information_schema.columns
          WHERE table_schema = '${rel.split(".")[0]}' AND table_name = '${rel.split(".")[1]}'
            AND column_name IN ('debit_minor','credit_minor') ORDER BY column_name`,
      ),
      "GL money column types",
    );
    // Money must be bigint minor units, not numeric — precision above 2^53.
    expect(cols.split("\n")).toEqual(["bigint", "bigint"]);
  });

  it("the imbalance detector catches a planted unbalanced journal (canary)", () => {
    // The table is empty in dev, so "no imbalance found" proves nothing. Plant a
    // balanced journal and an unbalanced one inside a transaction, assert the
    // detector returns exactly the unbalanced one, then ROLLBACK.
    const rel = resolveJournalLines();
    const balanced = "aaaaaaaa-0000-4000-8000-000000000001";
    const unbalanced = "aaaaaaaa-0000-4000-8000-000000000002";
    const head = "aaaaaaaa-0000-4000-8000-0000000000ff";
    const out = requireOk(
      psql(
        FIN.db,
        FIN.role,
        FIN.pw,
        `BEGIN;
         SET LOCAL app.tenant_id = '${TEST_TENANT}';
         INSERT INTO ${rel} (id, tenant_id, journal_id, head_id, debit_minor, credit_minor, posting_date, journal_type)
         VALUES (gen_random_uuid(), '${TEST_TENANT}', '${balanced}',   '${head}', 100, 100, current_date, 'journal'),
                (gen_random_uuid(), '${TEST_TENANT}', '${unbalanced}', '${head}', 100,  99, current_date, 'journal');
         SELECT 'HIT:' || journal_id FROM ${rel}
          GROUP BY journal_id HAVING SUM(debit_minor) <> SUM(credit_minor);
         ROLLBACK;
         SELECT 'AFTER:' || count(*) FROM ${rel};`,
      ),
      "double-entry detector canary",
    );
    const hits = out.split("\n").filter((l) => l.startsWith("HIT:")).map((l) => l.slice(4));
    expect(hits, "detector did not flag the planted unbalanced journal").toEqual([unbalanced]);
    expect(hits, "detector wrongly flagged the balanced journal").not.toContain(balanced);
    // Prove the canary left nothing behind.
    const after = out.split("\n").find((l) => l.startsWith("AFTER:"));
    expect(after, "canary rows were not rolled back").toBe("AFTER:0");
  });

  it("committed GL data has no unbalanced journal", () => {
    const rel = resolveJournalLines();
    const out = requireOk(
      psql(
        FIN.db,
        FIN.role,
        FIN.pw,
        `SELECT journal_id || ' dr=' || SUM(debit_minor) || ' cr=' || SUM(credit_minor)
           FROM ${rel} GROUP BY journal_id
          HAVING SUM(debit_minor) <> SUM(credit_minor) LIMIT 5`,
      ),
      "committed GL balance",
    );
    if (out !== "") {
      expect.fail(`Unbalanced journals in committed GL data:\n  ${out.split("\n").join("\n  ")}`);
    }
    // Row count is reported so an empty ledger is never mistaken for evidence
    // that real postings balance. The canary above is what proves the detector.
    const rows = requireOk(
      psql(FIN.db, FIN.role, FIN.pw, `SELECT count(*) FROM ${rel}`),
      "GL row count",
    );
    expect(Number(rows)).toBeGreaterThanOrEqual(0);
    if (rows === "0") {
      // eslint-disable-next-line no-console
      console.warn(
        `[L3] ${rel} holds 0 rows — the committed-data assertion is trivially true.` +
          " Coverage of real postings comes from the detector canary, not from this row.",
      );
    }
  });
});
