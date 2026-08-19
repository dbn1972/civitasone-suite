/**
 * Unit tests for `restore-drill.sh` pass/fail determinism and cleanup (task 16.2).
 *
 * Runs the REAL script against a fake `psql` on PATH (docker is steered away
 * via a bogus POSTGRES_CONTAINER name so the script always takes its direct-
 * psql fallback path, regardless of whether a real Postgres container happens
 * to be running on this machine). No real Postgres/docker-exec round trip is
 * required to exercise drillPassed()'s branches and the EXIT trap cleanup.
 *
 * Validates: Requirements 12.3, 12.5
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "../../scripts/ops/restore-drill.sh");

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length) {
    const dir = cleanupDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

interface FakePsqlOpts {
  createDbFail?: boolean;
  restoreFail?: boolean;
  tableCount?: number;
  sampleCheckFail?: boolean;
  dropLogPath: string;
}

/**
 * Fake `psql` covering every invocation shape restore-drill.sh makes:
 *   - `-d postgres -c "DROP DATABASE IF EXISTS X;"`  -> logs to dropLogPath, exit 0
 *   - `-d postgres -c "CREATE DATABASE X;"`          -> exit 0, or 1 if createDbFail
 *   - `-d X -t -c "SELECT count(*) FROM information_schema.tables..."` -> prints tableCount
 *   - `-d X -t -c "SELECT count(*) FROM <sample-table>;"`              -> exit 0/1 per sampleCheckFail
 *   - no `-c` at all (restore-from-stdin form)        -> consumes stdin, exit 0/1 per restoreFail
 */
function makeFakePsql(binDir: string, opts: FakePsqlOpts): void {
  const script = `#!/usr/bin/env bash
CMD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -c) CMD="$2"; shift 2 ;;
    -d) shift 2 ;;
    -U|-h|-p) shift 2 ;;
    -t) shift ;;
    *) shift ;;
  esac
done

if [[ "$CMD" == "DROP DATABASE"* ]]; then
  echo "drop" >> "${opts.dropLogPath}"
  exit 0
fi
if [[ "$CMD" == "CREATE DATABASE"* ]]; then
  ${opts.createDbFail ? "exit 1" : "exit 0"}
fi
if [[ "$CMD" == *"information_schema.tables"* ]]; then
  echo "${opts.tableCount ?? 10}"
  exit 0
fi
if [[ "$CMD" == "SELECT count(*) FROM"* ]]; then
  ${opts.sampleCheckFail ? "exit 1" : "echo 5; exit 0"}
fi
if [[ -z "$CMD" ]]; then
  # restore-from-stdin form
  cat > /dev/null
  ${opts.restoreFail ? "exit 1" : "exit 0"}
fi
exit 0
`;
  writeFileSync(join(binDir, "psql"), script);
  chmodSync(join(binDir, "psql"), 0o755);
}

function runDrill(opts: {
  service: string;
  backupExists: boolean;
  createDbFail?: boolean;
  restoreFail?: boolean;
  tableCount?: number;
  sampleCheckFail?: boolean;
  minTableCount?: number;
}) {
  const binDir = mkdtempSync(join(tmpdir(), "drill-fakebin-"));
  const backupDir = mkdtempSync(join(tmpdir(), "drill-backups-"));
  const dropLogPath = join(mkdtempSync(join(tmpdir(), "drill-droplog-")), "drops.log");
  cleanupDirs.push(binDir, backupDir, dirname(dropLogPath));

  makeFakePsql(binDir, {
    createDbFail: opts.createDbFail,
    restoreFail: opts.restoreFail,
    tableCount: opts.tableCount,
    sampleCheckFail: opts.sampleCheckFail,
    dropLogPath,
  });

  if (opts.backupExists) {
    const gz = gzipSync(Buffer.from("-- fake sql dump --\n"));
    writeFileSync(join(backupDir, `civitas_${opts.service}_20260101T000000Z.sql.gz`), gz);
  }

  const result = spawnSync(
    "bash",
    [SCRIPT, "--service", opts.service],
    {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        BACKUP_DIR: backupDir,
        PGHOST: "fake-host",
        PGPORT: "5555",
        PGUSER: "fake_user",
        // A container name that can never exist -> the script's docker-container
        // check always fails and it falls back to the direct-psql path.
        POSTGRES_CONTAINER: "civitasone-restore-drill-test-no-such-container",
        ...(opts.minTableCount !== undefined ? { MIN_TABLE_COUNT: String(opts.minTableCount) } : {}),
      },
      encoding: "utf-8",
      timeout: 30_000,
    },
  );

  const drops = existsSync(dropLogPath) ? readFileSync(dropLogPath, "utf-8").trim().split("\n").filter(Boolean) : [];
  return { result, drops };
}

describe("restore-drill.sh — pass/fail determinism", () => {
  it("a missing backup is classified as skipped (exit 0), never a false pass", () => {
    const { result } = runDrill({ service: "identity", backupExists: false });
    expect(result.stdout).toContain("SKIP: No backup found for identity");
    expect(result.status).toBe(0);
  });

  it("a fully healthy restore (sufficient tables + sample-row check passes) is deterministically PASS across repeated runs", () => {
    const opts = { service: "finance", backupExists: true, tableCount: 20, minTableCount: 5 };
    const first = runDrill(opts);
    const second = runDrill(opts);

    expect(first.result.stdout).toContain("PASS: Restore drill succeeded for finance");
    expect(first.result.status).toBe(0);
    expect(second.result.stdout).toContain("PASS: Restore drill succeeded for finance");
    expect(second.result.status).toBe(0);
  });

  it("a corrupted restore (pg_dump-content restore step fails) always yields FAILED, never a false PASS", () => {
    const { result } = runDrill({ service: "finance", backupExists: true, restoreFail: true, tableCount: 20 });
    expect(result.stdout).toContain("FAIL: Restore drill failed for finance");
    expect(result.status).toBe(1);
  });

  it("a below-threshold table count fails the drill even when the restore step itself succeeds", () => {
    const { result } = runDrill({ service: "finance", backupExists: true, tableCount: 1, minTableCount: 5 });
    expect(result.stdout).toContain("FAIL: Restore drill failed for finance");
    expect(result.status).toBe(1);
  });

  it("a failing sample-row check fails the drill even with a healthy table count", () => {
    const { result } = runDrill({ service: "finance", backupExists: true, tableCount: 20, sampleCheckFail: true });
    expect(result.stdout).toContain("FAIL: Restore drill failed for finance");
    expect(result.status).toBe(1);
  });

  it("a scratch-database creation failure fails the drill without ever calling it a pass", () => {
    const { result } = runDrill({ service: "finance", backupExists: true, createDbFail: true });
    expect(result.stdout).toContain("FAIL: Could not create scratch database for finance");
    expect(result.status).toBe(1);
  });
});

describe("restore-drill.sh — files/quarters/spaces/inventory schema coverage (task 39, Req 7.5)", () => {
  it("estab (owns the files/quarters/spaces PG schemas) has a registered sample-row check", () => {
    const script = readFileSync(SCRIPT, "utf-8");
    // `estab` is a single Postgres database (civitas_estab) shared across the
    // files.*, quarters.* and spaces.* PG schemas — one drill entry covers
    // all three, per services/estab-service/src/modules/{files,quarters,
    // spaces}/schema.ts each declaring their own pgSchema() under that DB.
    expect(script).toMatch(/\[estab\]="files\.estab_files"/);
  });

  it("inventory has a registered sample-row check, even though it is outside the fixed Tier-0/Tier-1 universe", () => {
    const script = readFileSync(SCRIPT, "utf-8");
    expect(script).toMatch(/\[inventory\]="inventory\.items"/);
  });

  it("a passing drill against the inventory service (drilled explicitly via --service, not --all-tier01) reports PASS", () => {
    const { result } = runDrill({ service: "inventory", backupExists: true, tableCount: 20, minTableCount: 5 });
    expect(result.stdout).toContain("PASS: Restore drill succeeded for inventory");
    expect(result.status).toBe(0);
  });

  it("a corrupted inventory restore is classified FAILED, never a false PASS", () => {
    const { result } = runDrill({ service: "inventory", backupExists: true, restoreFail: true, tableCount: 20 });
    expect(result.stdout).toContain("FAIL: Restore drill failed for inventory");
    expect(result.status).toBe(1);
  });
});

describe("restore-drill.sh — scratch DB cleanup (Req 12.5)", () => {
  it("drops the scratch DB on a successful drill", () => {
    const { drops } = runDrill({ service: "finance", backupExists: true, tableCount: 20 });
    // Pre-emptive DROP before CREATE, plus the post-drill DROP at the end of the loop body.
    expect(drops.length).toBeGreaterThanOrEqual(2);
  });

  it("drops the scratch DB even when the restore step fails mid-drill", () => {
    const { drops } = runDrill({ service: "finance", backupExists: true, restoreFail: true, tableCount: 20 });
    expect(drops.length).toBeGreaterThanOrEqual(2);
  });

  it("drops the scratch DB even when CREATE DATABASE itself fails", () => {
    const { drops } = runDrill({ service: "finance", backupExists: true, createDbFail: true });
    // Pre-emptive DROP, then the explicit DROP in the create-failure branch.
    expect(drops.length).toBeGreaterThanOrEqual(2);
  });

  it("issues no DROP DATABASE call when the service is skipped (no backup, no scratch DB was ever created)", () => {
    const { drops } = runDrill({ service: "identity", backupExists: false });
    expect(drops.length).toBe(0);
  });
});
