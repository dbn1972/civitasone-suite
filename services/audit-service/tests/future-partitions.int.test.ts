/**
 * Audit partition job (migration 0038): the month roll, ownership, grants and the non-owner caller.
 *
 * Background: on the UAT DB the worker (audit_svc) could not create events_y2027m02 because the parent
 * table is owned by another role ("must be owner of table events"), so partitions stopped at 2027-01.
 * These tests run the real helper against throwaway parents in a scratch schema (so no shared table is
 * locked or altered) and simulate time by passing the "as of" date.
 *
 * Needs a disposable Postgres bootstrapped by scripts/ci/bootstrap-postgres.sh. DATABASE_URL is audit_svc;
 * PGHOST/PGPORT/PGUSER/PGPASSWORD is the superuser used to set up and to call the date-injecting helper.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

const APP_DSN = process.env["DATABASE_URL"] ?? "";
const { PGHOST, PGPORT, PGUSER, PGPASSWORD } = process.env;
if (!APP_DSN || !PGHOST || !PGPORT || !PGUSER || !PGPASSWORD) {
  throw new Error("audit partitions test: set DATABASE_URL (audit_svc) and PGHOST/PGPORT/PGUSER/PGPASSWORD to a disposable Postgres");
}
const ADMIN_DSN = `postgres://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}:${PGPORT}/civitas_audit`;
const HELPER = "events.ensure_monthly_partitions";

const admin = postgres(ADMIN_DSN, { max: 2, onnotice: () => {} });
const app = postgres(APP_DSN, { max: 1, onnotice: () => {} });
const suffix = randomBytes(4).toString("hex");
const S = `pt_${suffix}`;

// The helper is SECURITY DEFINER, so scratch parents must belong to the helper's owner (audit_svc on a fresh
// bootstrap, the admin role on the UAT DB), exactly like events.events does.
let helperOwner = "";
async function makeParent(schema: string, name: string): Promise<void> {
  await admin.unsafe(`CREATE TABLE ${schema}.${name} (id int, created_at timestamptz NOT NULL) PARTITION BY RANGE (created_at)`);
  await admin.unsafe(`ALTER TABLE ${schema}.${name} OWNER TO ${helperOwner}`);
  await admin.unsafe(`CREATE TABLE ${schema}.${name}_default PARTITION OF ${schema}.${name} DEFAULT`);
  await admin.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON ${schema}.${name} TO audit_svc`);
}
async function ensure(parent: string, asOf: string, guard = false, months = 3): Promise<number> {
  const [r] = await admin.unsafe(
    `SELECT ${HELPER}('${S}', '${parent}', '${parent}', '${asOf}'::date, ${months}, ${guard}) AS n`);
  return (r as unknown as { n: number }).n;
}
async function partNames(parent: string): Promise<string[]> {
  const rows = await admin.unsafe(
    `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = '${S}.${parent}'::regclass AND c.relname !~ '_default$' ORDER BY 1`);
  return rows.map((r) => (r as unknown as { relname: string }).relname);
}

beforeAll(async () => {
  const [o] = await admin.unsafe(
    `SELECT pg_get_userbyid(proowner) AS o FROM pg_proc WHERE oid = '${HELPER}(text, text, text, date, int, boolean)'::regprocedure`);
  helperOwner = (o as unknown as { o: string }).o;
  await admin.unsafe(`CREATE SCHEMA ${S} AUTHORIZATION ${helperOwner}`);
});
afterAll(async () => {
  await admin.unsafe(`DROP SCHEMA IF EXISTS ${S} CASCADE`).catch(() => undefined);
  await admin.end({ timeout: 2 }).catch(() => undefined);
  await app.end({ timeout: 2 }).catch(() => undefined);
});

describe("ensure_monthly_partitions: the date rolling into a new month", () => {
  it("creates the current month and 3 ahead, and only the new month on the next roll", async () => {
    await makeParent(S, "roll");
    expect(await ensure("roll", "2027-01-15")).toBe(4);
    expect(await partNames("roll")).toEqual(["roll_y2027m01", "roll_y2027m02", "roll_y2027m03", "roll_y2027m04"]);

    // same month again: nothing to do (idempotent)
    expect(await ensure("roll", "2027-01-31")).toBe(0);
    // the first day of February: exactly one new partition, 2027-05
    expect(await ensure("roll", "2027-02-01")).toBe(1);
    expect((await partNames("roll")).at(-1)).toBe("roll_y2027m05");
  });

  it("handles the year boundary and creates exact UTC month ranges", async () => {
    await makeParent(S, "yr");
    await ensure("yr", "2027-11-20");
    expect(await partNames("yr")).toEqual(["yr_y2027m11", "yr_y2027m12", "yr_y2028m01", "yr_y2028m02"]);
    const rows = await admin.unsafe(
      `SELECT pg_get_expr(c.relpartbound, c.oid) AS b FROM pg_class c WHERE c.relname = 'yr_y2028m01' AND c.relnamespace = '${S}'::regnamespace`);
    expect((rows[0] as unknown as { b: string }).b).toContain("'2028-01-01 00:00:00+00'");
    expect((rows[0] as unknown as { b: string }).b).toContain("'2028-02-01 00:00:00+00'");
  });

  it("routes a row dated after the roll into its monthly partition, not the default", async () => {
    await makeParent(S, "ins");
    await ensure("ins", "2027-02-01");
    await admin.unsafe(`INSERT INTO ${S}.ins VALUES (1, '2027-04-30 23:59:59+00')`);
    const rows = await admin.unsafe(`SELECT tableoid::regclass::text AS t FROM ${S}.ins`);
    expect((rows[0] as unknown as { t: string }).t).toBe(`${S}.ins_y2027m04`);
  });

  it("rejects an out-of-range look-ahead", async () => {
    await makeParent(S, "bad");
    await expect(ensure("bad", "2027-01-01", false, 99)).rejects.toThrow(/out of range/);
  });
});

describe("ensure_monthly_partitions: ownership, grants and the guard", () => {
  it("owns new partitions like the parent, copies grants, and takes TRUNCATE/TRIGGER away from audit_svc", async () => {
    await makeParent(S, "own");
    await ensure("own", "2027-01-10", true);
    const rows = await admin.unsafe(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner,
              has_table_privilege('audit_svc', c.oid, 'INSERT') AS ins,
              has_table_privilege('audit_svc', c.oid, 'SELECT') AS sel,
              has_table_privilege('audit_svc', c.oid, 'TRUNCATE') AS trunc,
              has_table_privilege('audit_svc', c.oid, 'TRIGGER') AS trig,
              EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'trg_events_no_truncate') AS guard
         FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = '${S}.own'::regclass AND c.relname LIKE 'own_y%' ORDER BY 1`);
    expect(rows).toHaveLength(4);
    const parentOwner = (await admin.unsafe(`SELECT pg_get_userbyid(relowner) AS o FROM pg_class WHERE oid = '${S}.own'::regclass`))[0] as unknown as { o: string };
    for (const r of rows as unknown as Array<Record<string, unknown>>) {
      expect(r["owner"]).toBe(parentOwner.o);
      expect(r["ins"]).toBe(true);
      expect(r["sel"]).toBe(true);
      expect(r["trunc"]).toBe(false);
      expect(r["trig"]).toBe(false);
      expect(r["guard"]).toBe(true);
    }
    await expect(admin.unsafe(`TRUNCATE ${S}.own_y2027m02`)).rejects.toThrow();
  });

  it("re-applies the guard on a re-run (self-healing) without creating anything", async () => {
    await admin.unsafe(`GRANT TRUNCATE, TRIGGER ON ${S}.own_y2027m02 TO audit_svc`);
    expect(await ensure("own", "2027-01-10", true)).toBe(0);
    const [r] = await admin.unsafe(`SELECT has_table_privilege('audit_svc', '${S}.own_y2027m02', 'TRUNCATE') AS t`);
    expect((r as unknown as { t: boolean }).t).toBe(false);
  });
});

describe("ensure_monthly_partitions: rows already in the default partition", () => {
  it("skips only the blocked month with a warning and still creates the rest", async () => {
    await makeParent(S, "dflt");
    await admin.unsafe(`INSERT INTO ${S}.dflt VALUES (1, '2028-03-05 10:00:00+00')`);
    const n = await ensure("dflt", "2028-02-10");
    expect(n).toBe(3); // 2028-02, 04, 05 created; 2028-03 blocked
    expect(await partNames("dflt")).toEqual(["dflt_y2028m02", "dflt_y2028m04", "dflt_y2028m05"]);
  });
});

describe("the caller is not the owner of the parent table (the UAT situation)", () => {
  it("fails with 'must be owner' for a plain CREATE ... PARTITION OF, works through the definer helper", async () => {
    const role = `ptowner_${suffix}`;
    const schema = `ptn_${suffix}`;
    const rollback = new Error("rollback");
    await admin
      .begin(async (tx) => {
        await tx.unsafe(`CREATE ROLE ${role} NOLOGIN`);
        await tx.unsafe(`CREATE SCHEMA ${schema} AUTHORIZATION ${role}`);
        await tx.unsafe(`GRANT USAGE, CREATE ON SCHEMA ${schema} TO audit_svc`);
        await tx.unsafe(`CREATE TABLE ${schema}.ev (id int, created_at timestamptz NOT NULL) PARTITION BY RANGE (created_at)`);
        await tx.unsafe(`ALTER TABLE ${schema}.ev OWNER TO ${role}`);
        // the helper must be owned by the table owner, as the apply script / 0038 section 5 arrange
        await tx.unsafe(`GRANT CREATE ON SCHEMA events TO ${role}`);
        await tx.unsafe(`ALTER FUNCTION ${HELPER}(text, text, text, date, int, boolean) OWNER TO ${role}`);
        await tx.unsafe(`GRANT EXECUTE ON FUNCTION ${HELPER}(text, text, text, date, int, boolean) TO audit_svc`);

        await tx.unsafe(`SET LOCAL ROLE audit_svc`);
        await expect(tx.savepoint(async (sp) => {
          await sp.unsafe(`CREATE TABLE ${schema}.ev_y2027m02 PARTITION OF ${schema}.ev FOR VALUES FROM ('2027-02-01') TO ('2027-03-01')`);
        })).rejects.toThrow(/must be owner of table ev/);

        const [r] = await tx.unsafe(`SELECT ${HELPER}('${schema}', 'ev', 'ev', '2027-02-01'::date, 3, false) AS n`);
        expect((r as unknown as { n: number }).n).toBe(4);
        await tx.unsafe(`RESET ROLE`);
        const owners = await tx.unsafe(
          `SELECT DISTINCT pg_get_userbyid(c.relowner) AS o FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = '${schema}.ev'::regclass`);
        expect(owners.map((x) => (x as unknown as { o: string }).o)).toEqual([role]);
        throw rollback;
      })
      .catch((e: unknown) => { if (e !== rollback) throw e; });
  });
});

describe("the real functions (as the worker calls them, as audit_svc)", () => {
  it("create_future_partitions() leaves nothing missing for the next 3 months and is repeatable", async () => {
    await app`SELECT events.create_future_partitions()`;
    await app`SELECT _outbox.create_future_partitions()`;
    await app`SELECT events.create_future_partitions()`;
    const [m] = await app`SELECT events.missing_future_partitions() AS n`;
    expect(m!["n"]).toBe(0);
  });

  it("missing_future_partitions() reports a horizon that has not been created yet", async () => {
    const [m] = await app`SELECT events.missing_future_partitions('2040-01-01'::date) AS n`;
    expect(m!["n"]).toBe(4);
  });

  it("the helper that takes an arbitrary date is not executable by PUBLIC", async () => {
    const rows = await admin.unsafe(
      `SELECT count(*)::int AS n FROM pg_proc p, aclexplode(p.proacl) a
        WHERE p.oid = '${HELPER}(text, text, text, date, int, boolean)'::regprocedure AND a.grantee = 0`);
    expect((rows[0] as unknown as { n: number }).n).toBe(0);
  });

  it("the zero-argument wrappers are executable by audit_svc and not by PUBLIC", async () => {
    for (const fn of ["events.create_future_partitions()", "_outbox.create_future_partitions()"]) {
      const [r] = await admin.unsafe(
        `SELECT has_function_privilege('audit_svc', '${fn}'::regprocedure, 'EXECUTE') AS app,
                (SELECT count(*)::int FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = '${fn}'::regprocedure AND a.grantee = 0) AS pub`);
      expect(r, fn).toMatchObject({ app: true, pub: 0 });
    }
  });
});
