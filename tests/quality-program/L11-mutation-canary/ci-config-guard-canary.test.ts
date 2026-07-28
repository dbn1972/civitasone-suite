/**
 * L11 — Canaries for scripts/ci/ci-config-guard.mjs
 *
 * WHY THIS FILE EXISTS
 * The guard's canaries were originally run from a throwaway shell harness that was
 * deleted afterwards. So the guard was proven once, at the moment it was written,
 * and every edit after that was unprotected. A gate whose validity is not itself
 * under test is one refactor away from being theater — which is exactly what this
 * lane exists to prevent.
 *
 * That is not hypothetical for this particular guard. Its first TCP check was
 * `/-h\s*\S+/`, which matched the `-h` inside `--health-interval`, so a socket-only
 * `--health-cmd pg_isready` PASSED. The guard carried the very defect class it
 * exists to catch. It was found because the harness asserted on the failure
 * MESSAGE and not just the exit code: the canary failed with `no -U <role>` instead
 * of `does not force TCP`, and both are exit 1. These tests assert messages for the
 * same reason.
 *
 * METHOD
 * Each test copies the real workflow and bootstrap files to a scratch directory,
 * plants one defect, runs the guard with REPO_ROOT pointed at the copy, and asserts
 * both the exit code and the specific message. Nothing under version control is
 * modified, so a crashing test cannot leave the repo dirty — the shell harness had
 * to restore files by hand and assert `git diff --quiet` afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(__dirname, "../../..");
const GUARD_REL = "scripts/ci/ci-config-guard.mjs";

/** Health-check line the real ci.yml uses; the anchor every plant edits. */
const REAL_HEALTH_CMD = '          --health-cmd "pg_isready -h 127.0.0.1 -p 5432 -U civitas"';

interface GuardResult {
  exitCode: number;
  output: string;
}

let sandboxRoot: string;

/**
 * A minimal but faithful copy of the repo: the guard only reads
 * .github/workflows, infra/db/bootstrap and scripts/ci.
 */
function makeSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "ci-config-guard-canary-"));
  for (const rel of [".github/workflows", "infra/db/bootstrap", "scripts/ci"]) {
    mkdirSync(join(dir, rel), { recursive: true });
    cpSync(join(REPO_ROOT, rel), join(dir, rel), { recursive: true });
  }
  return dir;
}

function runGuard(root: string): GuardResult {
  try {
    const out = execFileSync("node", [join(root, GUARD_REL)], {
      encoding: "utf8",
      timeout: 30_000,
      cwd: root,
    });
    return { exitCode: 0, output: out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: err.status ?? -1,
      output: `${err.stdout ?? ""}\n${err.stderr ?? ""}`,
    };
  }
}

/** Plant a replacement for the first occurrence of the health-check line. */
function plantHealthCmd(root: string, replacement: string): void {
  const f = join(root, ".github/workflows/ci.yml");
  const src = readFileSync(f, "utf8");
  expect(
    src.includes(REAL_HEALTH_CMD),
    "anchor health-cmd line not found in ci.yml — this canary would be vacuous",
  ).toBe(true);
  writeFileSync(f, src.replace(REAL_HEALTH_CMD, replacement));
}

beforeAll(() => {
  sandboxRoot = makeSandbox();
});

afterAll(() => {
  if (sandboxRoot) rmSync(sandboxRoot, { recursive: true, force: true });
});

describe("L11 — Canary: ci-config-guard is not vacuous", () => {
  it("CANARY BASELINE: an unmodified copy of the repo passes", () => {
    // If this fails, every canary below is meaningless — they would "detect" a
    // defect that was already present.
    const r = runGuard(makeSandboxThenDispose());
    expect(r.exitCode, `guard failed on a clean tree:\n${r.output}`).toBe(0);
    expect(r.output).toContain("CLEAN");
  });

  it("CANARY: an orphaned bootstrap file is caught", () => {
    const root = makeSandboxThenKeep();
    // Any .sql file the bootstrap script does not name.
    cpSync(
      join(root, "infra/db/bootstrap/bootstrap_missing_schemas.sql"),
      join(root, "infra/db/bootstrap/bootstrap_canary_orphan.sql"),
    );
    const r = runGuard(root);
    expect(r.exitCode, "orphaned bootstrap file was NOT caught").toBe(1);
    expect(r.output).toContain("invoked by nothing");
    expect(r.output).toContain("bootstrap_canary_orphan.sql");
    rmSync(root, { recursive: true, force: true });
  });

  it("CANARY: a reference to a non-existent bootstrap file is caught", () => {
    const root = makeSandboxThenKeep();
    const f = join(root, "scripts/ci/bootstrap-postgres.sh");
    writeFileSync(
      f,
      readFileSync(f, "utf8").replace("bootstrap_admin_role.sql", "bootstrap_does_not_exist.sql"),
    );
    const r = runGuard(root);
    expect(r.exitCode, "dangling bootstrap reference was NOT caught").toBe(1);
    expect(r.output).toContain("references a missing file");
    rmSync(root, { recursive: true, force: true });
  });

  it("CANARY: a socket-only health check is caught (the regression that shipped)", () => {
    const root = makeSandboxThenKeep();
    plantHealthCmd(root, "          --health-cmd pg_isready");
    const r = runGuard(root);
    expect(r.exitCode, "socket-only pg_isready was NOT caught").toBe(1);
    // The MESSAGE matters, not just the exit code. The guard's own regex bug
    // produced exit 1 with the wrong message, which is how it hid.
    expect(
      r.output,
      "caught, but for the wrong reason — check the -h regex is not matching --health-interval",
    ).toContain("does not force TCP");
    rmSync(root, { recursive: true, force: true });
  });

  it("CANARY: -h matching inside --health-interval does not satisfy the TCP check", () => {
    const root = makeSandboxThenKeep();
    // Explicit regression test for the guard's own bug: this string contains `-h`
    // (inside --health-interval) but forces no host.
    plantHealthCmd(root, "          --health-cmd pg_isready -U civitas");
    const r = runGuard(root);
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain("does not force TCP");
    rmSync(root, { recursive: true, force: true });
  });

  it("CANARY: a -U role that does not match POSTGRES_USER is caught", () => {
    const root = makeSandboxThenKeep();
    plantHealthCmd(root, '          --health-cmd "pg_isready -h 127.0.0.1 -p 5432 -U wrong_role"');
    const r = runGuard(root);
    expect(r.exitCode, "role mismatch was NOT caught").toBe(1);
    expect(r.output).toContain("POSTGRES_USER is civitas");
    rmSync(root, { recursive: true, force: true });
  });

  it("CANARY: a missing --health-cmd is caught", () => {
    const root = makeSandboxThenKeep();
    plantHealthCmd(root, "          --health-interval 10s");
    const r = runGuard(root);
    expect(r.exitCode, "missing health-cmd was NOT caught").toBe(1);
    expect(r.output).toContain("no --health-cmd");
    rmSync(root, { recursive: true, force: true });
  });

  it("CANARY: a '#' inside the folded options scalar is caught", () => {
    const root = makeSandboxThenKeep();
    // `options: >-` is a folded block scalar: '#' is literal text that would be
    // passed to `docker create`, not a comment. This happened for real.
    plantHealthCmd(root, `          # planted comment inside the folded scalar\n${REAL_HEALTH_CMD}`);
    const r = runGuard(root);
    expect(r.exitCode, "comment inside the folded scalar was NOT caught").toBe(1);
    expect(r.output).toContain("folded block scalar");
    rmSync(root, { recursive: true, force: true });
  });

  describe("ratchet escape hatches must never appear in a CI step", () => {
    const hatches: Array<[string, string, string]> = [
      [
        "--allow-stale",
        "        run: node scripts/ci/schema-drift-guard.mjs --allow-stale",
        "relaxes stale detection",
      ],
      [
        "--write-baseline",
        "        run: node scripts/ci/schema-drift-guard.mjs --write-baseline",
        "rewrites the drift baseline",
      ],
      [
        "BOOTSTRAP_WRITE_ALLOWLIST",
        "        run: BOOTSTRAP_WRITE_ALLOWLIST=1 bash scripts/ci/bootstrap-postgres.sh",
        "rewrites the migration failure allow-list",
      ],
    ];

    for (const [flag, planted, message] of hatches) {
      it(`CANARY: \`${flag}\` in a CI step is caught`, () => {
        const root = makeSandboxThenKeep();
        const f = join(root, ".github/workflows/ci.yml");
        const src = readFileSync(f, "utf8");
        const anchor = "        run: node scripts/ci/schema-drift-guard.mjs";
        expect(src.includes(anchor), "anchor step not found — canary would be vacuous").toBe(true);
        writeFileSync(f, src.replace(anchor, planted));
        const r = runGuard(root);
        expect(r.exitCode, `${flag} in a CI step was NOT caught`).toBe(1);
        expect(r.output).toContain(message);
        rmSync(root, { recursive: true, force: true });
      });
    }

    it("the YAML comment explaining why --allow-stale is absent is NOT a false positive", () => {
      // ci.yml documents the flag's absence in a comment. If the check matched
      // comments it would be permanently red, and the natural "fix" would be to
      // delete the explanation.
      const src = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
      expect(
        src.includes("--allow-stale"),
        "expected ci.yml to mention --allow-stale in a comment; if that note was removed, this test no longer proves anything",
      ).toBe(true);
      const r = runGuard(makeSandboxThenDispose());
      expect(r.exitCode, `the comment tripped the check:\n${r.output}`).toBe(0);
    });
  });
});

/** Fresh sandbox for a test that will clean up after itself. */
function makeSandboxThenKeep(): string {
  return makeSandbox();
}

/**
 * Fresh sandbox for a read-only assertion. Registered for removal via the shared
 * root so a failing expectation cannot leak a temp directory.
 */
function makeSandboxThenDispose(): string {
  const d = makeSandbox();
  disposable.push(d);
  return d;
}

const disposable: string[] = [];
afterAll(() => {
  for (const d of disposable) rmSync(d, { recursive: true, force: true });
});
