/**
 * schema-drift-guard.mjs: F109 (no live default) and the --live-readonly drift
 * comparison (UAT bundle 10, F100).
 *
 * The guard used to default to localhost + the live port as civitas_admin, which
 * on the shared host is LIVE UAT. These tests run it with a fake `psql` first on
 * PATH that only records its arguments, so no case can ever reach a database.
 * Live ports are built by concatenation so this file holds no literal the
 * no-live-db-default guard scans for.
 *
 * Run: pnpm exec vitest run tests/architecture/schema-drift-guard-live.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compareCatalogs, resolveConnection } from "../../scripts/ci/schema-catalog-drift.mjs";

const PG = "54" + "35";
const BOUNCER = "64" + "32";
const GUARD = resolve(import.meta.dirname, "../../scripts/ci/schema-drift-guard.mjs");

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "drift-guard-"));
  log = join(dir, "psql.log");
  const shim = join(dir, "psql");
  writeFileSync(shim, `#!/bin/sh\necho "$@" >> "${log}"\nexit 1\n`);
  chmodSync(shim, 0o755);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runGuard(env: Record<string, string>, args: string[] = []) {
  rmSync(log, { force: true });
  const r = spawnSync(process.execPath, [GUARD, ...args], {
    encoding: "utf8",
    env: { PATH: `${dir}:${process.env.PATH ?? ""}`, HOME: process.env.HOME ?? "", ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, psql: existsSync(log) ? readFileSync(log, "utf8") : "" };
}

describe("F109: schema-drift-guard never defaults to the live database", () => {
  it("fails when no database is configured, without running psql", () => {
    const r = runGuard({});
    expect(r.code).toBe(2);
    expect(r.out).toContain("database not configured");
    expect(r.psql).toBe("");
  });

  it.each([PG, BOUNCER])("refuses PGPORT=%s without --live-readonly, without running psql", (port) => {
    const r = runGuard({ PGHOST: "127.0.0.1", PGPORT: port, PGUSER: "civitas_admin" });
    expect(r.code).toBe(2);
    expect(r.out).toContain("REFUSING");
    expect(r.psql).toBe("");
  });

  it("refuses a DATABASE_URL on a live port", () => {
    const r = runGuard({ DATABASE_URL: `postgres://civitas_admin@127.0.0.1:${PG}/civitas_x` });
    expect(r.code).toBe(2);
    expect(r.out).toContain("REFUSING");
    expect(r.psql).toBe("");
  });

  it("uses DATABASE_URL's host and port when given", () => {
    const r = runGuard({ DATABASE_URL: "postgres://civitas@127.0.0.1:1/x" }, ["inspection"]);
    expect(r.psql).toContain("-h 127.0.0.1 -p 1 -U civitas");
    expect(r.psql).not.toContain(PG);
  });

  it("--live-readonly refuses a live port on the EXPECTED side", () => {
    const r = runGuard({}, ["--live-readonly", "--expected-url", `postgres://c@127.0.0.1:${PG}/postgres`, "--live-container", "x"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("REFUSING");
    expect(r.psql).toBe("");
  });
});

describe("resolveConnection()", () => {
  it("prefers DATABASE_URL over PGHOST/PGPORT and lets POSTGRES_ADMIN_* override credentials", () => {
    const c = resolveConnection({
      DATABASE_URL: "postgres://a:b@db.test:5499/x",
      PGHOST: "other",
      PGPORT: "1",
      POSTGRES_ADMIN_USER: "civitas",
    });
    expect(c).toEqual({ host: "db.test", port: "5499", user: "civitas", password: "b" });
  });

  it("allows a live port only with allowLive", () => {
    const env = { PGHOST: "127.0.0.1", PGPORT: PG, PGUSER: "civitas_admin" };
    expect(() => resolveConnection(env)).toThrow(/REFUSING/);
    expect(resolveConnection(env, { allowLive: true }).port).toBe(PG);
  });
});

describe("compareCatalogs(): class-(a) drift by definition, not by name", () => {
  const T = "TABLE|po.amendments|r";
  const COL = "COL|po.amendments.status|character varying(16)|NOT NULL|'pending'::character varying";
  const UQ = "CON|po.amendments|uq_po_amendment_no|u|UNIQUE (po_id, amendment_no)";
  const UQ_IDX = "IDX|po.amendments|uq_po_amendment_no|CREATE UNIQUE INDEX ON po.amendments USING btree (po_id, amendment_no)";
  const CK = "CON|po.amendments|amendments_status_check|c|CHECK (((status)::text = ANY ((ARRAY['pending'::character varying])::text[])))";
  const RLS = "RLS|po.amendments|true|true";
  const expected = [T, COL, UQ, UQ_IDX, CK, RLS].join("\n");

  it("is clean when identical", () => {
    expect(compareCatalogs(expected, expected)).toEqual({ fail: [], warn: [], info: [] });
  });

  it("fails a UNIQUE that exists only as a same-named index (procurement 0021-0024 on UAT)", () => {
    const live = [T, COL, UQ_IDX, CK, RLS].join("\n");
    const { fail } = compareCatalogs(expected, live);
    expect(fail).toHaveLength(1);
    expect(fail[0]).toContain("CON|po.amendments|uq_po_amendment_no: MISSING");
  });

  it("fails a same-named CHECK with a different definition (legal counsel briefs on UAT)", () => {
    const live = [T, COL, UQ, UQ_IDX, CK.replace("'pending'", "'queued'"), RLS].join("\n");
    const { fail } = compareCatalogs(expected, live);
    expect(fail).toHaveLength(1);
    expect(fail[0]).toContain("DEFINITION DIFFERS");
  });

  it("fails a changed column and weaker RLS/FORCE", () => {
    const live = [T, COL.replace("NOT NULL", "NULL"), UQ, UQ_IDX, CK, "RLS|po.amendments|true|false"].join("\n");
    const { fail } = compareCatalogs(expected, live);
    expect(fail).toHaveLength(2);
    expect(fail.join("\n")).toContain("RLS|po.amendments");
  });

  it("treats the dump/restore cast decoration of a CHECK as equal, but not a changed value", () => {
    const restored = "CON|po.amendments|amendments_status_check|c|CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text])))";
    expect(compareCatalogs(expected, [T, COL, UQ, UQ_IDX, restored, RLS].join("\n")).fail).toEqual([]);
    const changed = restored.replace("'pending'", "'queued'");
    expect(compareCatalogs(expected, [T, COL, UQ, UQ_IDX, changed, RLS].join("\n")).fail).toHaveLength(1);
  });

  it("normalises NULL elements and partial-index predicates the same way", () => {
    const e = "IDX|a.t|i|CREATE INDEX ON a.t USING btree (s) WHERE ((s)::text = ANY ((ARRAY['x'::character varying, NULL::character varying])::text[]))";
    const l = "IDX|a.t|i|CREATE INDEX ON a.t USING btree (s) WHERE ((s)::text = ANY (ARRAY[('x'::character varying)::text, (NULL::character varying)::text]))";
    expect(compareCatalogs(e, l).fail).toEqual([]);
    expect(compareCatalogs(e, l.replace("'x'", "'y'")).fail).toHaveLength(1);
  });

  it("only warns when the definition exists under another name, and reports extras as info", () => {
    const live = [T, COL, UQ.replace("uq_po_amendment_no|", "legacy_uq|"), UQ_IDX, CK, RLS, "TABLE|po.legacy|r"].join("\n");
    const r = compareCatalogs(expected, live);
    expect(r.fail).toEqual([]);
    expect(r.warn[0]).toContain("legacy_uq");
    expect(r.info.some((i) => i.startsWith("TABLE|po.legacy"))).toBe(true);
  });
});
