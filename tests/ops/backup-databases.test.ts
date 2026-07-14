/**
 * Unit tests for `backup-databases.sh` outcome classification (task 15.4).
 *
 * Runs the REAL script (no mocking of bash logic) against fake `psql` /
 * `pg_dump` executables placed on PATH, so the classification rules
 * (missing database -> skipped, pg_dump failure -> failed, success -> success)
 * and the pass/fail exit-code delegation to outcome-aggregation.mjs are
 * exercised end-to-end without needing a real Postgres instance.
 *
 * Validates: Requirements 11.2, 11.4
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "../../scripts/ops/backup-databases.sh");

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length) {
    const dir = cleanupDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Sets up a fake-bin directory containing `psql` and `pg_dump` stand-ins:
 *   - fake `psql`: answers the `pg_database` existence check. Returns "1"
 *     (exists) iff the queried db name is in `existingDbs`, else empty.
 *   - fake `pg_dump`: writes a few bytes to stdout and exits 0, UNLESS the
 *     `-d <db>` argument names a database in `failingDbs`, in which case it
 *     writes to stderr and exits 1 (simulating a real pg_dump failure).
 */
function makeFakeBin(existingDbs: string[], failingDbs: string[]): string {
  const binDir = mkdtempSync(join(tmpdir(), "backup-fakebin-"));
  cleanupDirs.push(binDir);

  const psqlScript = `#!/usr/bin/env bash
# Fake psql: only implements the "-tAc SELECT 1 FROM pg_database WHERE datname = 'X'" query
# that backup-databases.sh performs for the existence check.
QUERY="\${*}"
for db in ${existingDbs.map((d) => `"${d}"`).join(" ")}; do
  if [[ "\${QUERY}" == *"datname = '\${db}'"* ]]; then
    echo "1"
    exit 0
  fi
done
exit 0
`;
  writeFileSync(join(binDir, "psql"), psqlScript);
  chmodSync(join(binDir, "psql"), 0o755);

  const failing = failingDbs.map((d) => `"${d}"`).join(" ");
  const pgDumpScript = `#!/usr/bin/env bash
# Fake pg_dump: parses -d <dbname>, fails for names in the failing list.
DB=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-d" ]]; then DB="$2"; fi
  shift
done
for db in ${failing}; do
  if [[ "\${DB}" == "\${db}" ]]; then
    echo "fake pg_dump: simulated failure for \${DB}" >&2
    exit 1
  fi
done
echo "-- fake dump content for \${DB} --"
exit 0
`;
  writeFileSync(join(binDir, "pg_dump"), pgDumpScript);
  chmodSync(join(binDir, "pg_dump"), 0o755);

  return binDir;
}

function runBackupScript(opts: { existingDbs: string[]; failingDbs: string[]; retentionDays?: number }) {
  const fakeBin = makeFakeBin(opts.existingDbs, opts.failingDbs);
  const backupDir = mkdtempSync(join(tmpdir(), "backup-out-"));
  cleanupDirs.push(backupDir);

  const result = spawnSync("bash", [SCRIPT, backupDir], {
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      PGHOST: "fake-host",
      PGPORT: "5555",
      ...(opts.retentionDays !== undefined ? { BACKUP_RETENTION_DAYS: String(opts.retentionDays) } : {}),
    },
    encoding: "utf-8",
    timeout: 30_000,
  });
  return result;
}

describe("backup-databases.sh — outcome classification", () => {
  it("a missing database is classified as skipped, not failed", () => {
    // Only civitas_finance exists; every other of the 33 databases is "missing"
    // in this environment -> skipped, and skipped alone never fails the job.
    const result = runBackupScript({ existingDbs: ["civitas_finance"], failingDbs: [] });

    expect(result.stdout).toContain("civitas_admin skipped (database does not exist");
    expect(result.stdout).toContain("civitas_finance complete");
    expect(result.status).toBe(0);
  });

  it("a pg_dump failure on a Tier-0/Tier-1 database (finance) is classified as failed and fails the job", () => {
    const result = runBackupScript({
      existingDbs: ["civitas_finance"],
      failingDbs: ["civitas_finance"],
    });

    expect(result.stdout).toContain("civitas_finance FAILED");
    expect(result.status).toBe(1);
  });

  it("a pg_dump failure limited to a Tier-2-only database (billing) does not fail the job by itself", () => {
    // billing is not in the Tier-0/Tier-1 critical universe (gateway, identity,
    // queue, finance, estab, workflow, hrms, payroll, audit).
    const result = runBackupScript({
      existingDbs: ["civitas_billing"],
      failingDbs: ["civitas_billing"],
    });

    expect(result.stdout).toContain("civitas_billing FAILED");
    expect(result.status).toBe(0);
  });

  it("a Tier-0/Tier-1 failure fails the job even when many other databases succeed", () => {
    const existingDbs = ["civitas_finance", "civitas_hrms", "civitas_billing", "civitas_identity"];
    const result = runBackupScript({ existingDbs, failingDbs: ["civitas_hrms"] });

    expect(result.stdout).toContain("civitas_hrms FAILED");
    expect(result.stdout).toContain("civitas_finance complete");
    expect(result.stdout).toContain("civitas_billing complete");
    expect(result.status).toBe(1);
  });

  it("a fully successful run (every existing database dumps cleanly) exits 0 and reports per-database counts", () => {
    const existingDbs = ["civitas_finance", "civitas_hrms", "civitas_audit"];
    const result = runBackupScript({ existingDbs, failingDbs: [] });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/3 succeeded, 0 failed, \d+ skipped out of 33 databases/);
  });
});
