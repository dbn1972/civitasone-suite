/**
 * Unit tests for `verify-pgbouncer-routing.mjs` fixtures (task 10.2).
 *
 * Exercises `classifyFleet()` directly with in-memory `pg_stat_activity`-shaped
 * datasets (no live Postgres/psql/docker required): a fully compliant fleet,
 * one non-compliant service, and an empty fleet — asserting per-service
 * report contents and the caller-facing exit-code decision (`overallCompliant`).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 *
 * NOTE: lives under tests/ops/ (not scripts/ops/tests/) because the root
 * vitest.config.mjs only includes "tests/**\/*.test.ts" — mirrors the existing
 * convention for scripts/ci/*.mjs tests living under tests/architecture/.
 */
import { describe, it, expect } from "vitest";
import {
  classifyFleet,
  KNOWN_SERVICES,
  dbNameFor,
  envVarFor,
  parseCsv,
} from "../../scripts/ops/verify-pgbouncer-routing.mjs";

describe("verify-pgbouncer-routing: classifyFleet — fully compliant fleet", () => {
  it("every service with observed connections is compliant when all route via the pgbouncer hint, and services with zero connections are still reported individually", () => {
    const rows = [
      { datname: dbNameFor("finance"), application_name: "pgbouncer", client_addr: "10.0.0.5", count: 3 },
      { datname: dbNameFor("hrms"), application_name: "", client_addr: "10.0.0.6", client_hostname: "pgbouncer.internal", count: 2 },
    ];

    const report = classifyFleet(rows);

    expect(report.overallCompliant).toBe(true);
    expect(report.nonCompliantServices).toEqual([]);
    // Every KNOWN_SERVICES entry appears in the report, not just the ones with connections.
    expect(report.services).toHaveLength(KNOWN_SERVICES.length);

    const financeEntry = report.services.find((s) => s.service === "finance");
    expect(financeEntry).toMatchObject({
      service: "finance",
      database: "civitas_finance",
      envVar: "DATABASE_URL_FINANCE",
      connections: 3,
      viaProxy: 3,
      direct: 0,
      compliant: true,
    });

    const hrmsEntry = report.services.find((s) => s.service === "hrms");
    expect(hrmsEntry).toMatchObject({ connections: 2, viaProxy: 2, direct: 0, compliant: true });

    // A service with zero observed connections is still reported, and compliant
    // (nothing to bypass the proxy) — Req 6.2 "report every compliant service".
    const untouchedEntry = report.services.find((s) => s.service === "identity");
    expect(untouchedEntry).toMatchObject({ connections: 0, viaProxy: 0, direct: 0, compliant: true });
  });
});

describe("verify-pgbouncer-routing: classifyFleet — one non-compliant service", () => {
  it("flags exactly the one service with a direct (non-proxied) connection, without short-circuiting the rest of the report", () => {
    const rows = [
      { datname: dbNameFor("finance"), application_name: "pgbouncer", client_addr: "10.0.0.5", count: 5 },
      // hrms connects directly — no pgbouncer hint anywhere in this row.
      { datname: dbNameFor("hrms"), application_name: "node", client_addr: "10.0.0.9", client_hostname: "hrms-pod-1", count: 4 },
      { datname: dbNameFor("payroll"), application_name: "pgbouncer", client_addr: "10.0.0.7", count: 1 },
    ];

    const report = classifyFleet(rows);

    expect(report.overallCompliant).toBe(false);
    expect(report.nonCompliantServices).toEqual(["hrms"]);

    const hrmsEntry = report.services.find((s) => s.service === "hrms");
    expect(hrmsEntry).toMatchObject({ connections: 4, viaProxy: 0, direct: 4, compliant: false });

    // Every OTHER service is still reported and still correctly compliant —
    // one non-compliant service never suppresses the rest of the report.
    const financeEntry = report.services.find((s) => s.service === "finance");
    expect(financeEntry?.compliant).toBe(true);
    const payrollEntry = report.services.find((s) => s.service === "payroll");
    expect(payrollEntry?.compliant).toBe(true);
    expect(report.services).toHaveLength(KNOWN_SERVICES.length);
  });

  it("a service with a MIX of proxied and direct connections is non-compliant (any direct connection fails it)", () => {
    const rows = [
      { datname: dbNameFor("citizen"), application_name: "pgbouncer", client_addr: "10.0.0.5", count: 10 },
      { datname: dbNameFor("citizen"), application_name: "node-direct", client_addr: "10.0.0.11", count: 1 },
    ];

    const report = classifyFleet(rows);

    const citizenEntry = report.services.find((s) => s.service === "citizen");
    expect(citizenEntry).toMatchObject({ connections: 11, viaProxy: 10, direct: 1, compliant: false });
    expect(report.overallCompliant).toBe(false);
    expect(report.nonCompliantServices).toEqual(["citizen"]);
  });
});

describe("verify-pgbouncer-routing: classifyFleet — empty fleet", () => {
  it("an empty/undefined rows input yields a fully compliant report with every known service present at zero connections", () => {
    for (const rows of [[], undefined]) {
      const report = classifyFleet(rows);
      expect(report.overallCompliant).toBe(true);
      expect(report.nonCompliantServices).toEqual([]);
      expect(report.services).toHaveLength(KNOWN_SERVICES.length);
      for (const entry of report.services) {
        expect(entry.connections).toBe(0);
        expect(entry.compliant).toBe(true);
      }
    }
  });

  it("rows referencing a database outside the known 33 services are ignored, not misattributed", () => {
    const rows = [{ datname: "some_unrelated_db", application_name: "node-direct", client_addr: "10.0.0.99", count: 7 }];
    const report = classifyFleet(rows);
    expect(report.overallCompliant).toBe(true);
    expect(report.services.every((s) => s.connections === 0)).toBe(true);
  });
});

describe("verify-pgbouncer-routing: helper functions", () => {
  it("dbNameFor / envVarFor produce the documented naming convention", () => {
    expect(dbNameFor("finance")).toBe("civitas_finance");
    expect(envVarFor("finance")).toBe("DATABASE_URL_FINANCE");
    expect(envVarFor("hrms")).toBe("DATABASE_URL_HRMS");
  });

  it("KNOWN_SERVICES contains exactly the documented 33 services with no duplicates", () => {
    expect(KNOWN_SERVICES).toHaveLength(33);
    expect(new Set(KNOWN_SERVICES).size).toBe(33);
  });

  it("a custom pgbouncerHint overrides the default 'pgbouncer' substring match", () => {
    const rows = [{ datname: dbNameFor("finance"), application_name: "", client_addr: "10.0.0.5", client_hostname: "connproxy-1", count: 1 }];
    const withoutHint = classifyFleet(rows);
    expect(withoutHint.services.find((s) => s.service === "finance")?.compliant).toBe(false);

    const withHint = classifyFleet(rows, KNOWN_SERVICES, { pgbouncerHint: "connproxy" });
    expect(withHint.services.find((s) => s.service === "finance")?.compliant).toBe(true);
  });

  it("parseCsv parses a minimal psql --csv-shaped export, including quoted fields", () => {
    const csv = 'datname,application_name,client_addr,count\n"civitas_finance","pgbouncer","10.0.0.5",3\n"civitas_hrms","","10.0.0.6",1\n';
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      { datname: "civitas_finance", application_name: "pgbouncer", client_addr: "10.0.0.5", count: "3" },
      { datname: "civitas_hrms", application_name: "", client_addr: "10.0.0.6", count: "1" },
    ]);
  });

  it("parseCsv returns an empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv(undefined)).toEqual([]);
  });
});
