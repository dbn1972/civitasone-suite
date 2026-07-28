#!/usr/bin/env node
/**
 * ci-config-guard.mjs — static checks on CI and bootstrap configuration.
 *
 * Both checks exist because a real defect got through, and neither is detectable
 * by any test: they are properties of configuration, not of code.
 *
 * ── CHECK 1: every bootstrap SQL file is reachable from the script that runs it
 *
 * `infra/db/bootstrap/bootstrap_remaining_services.sql` was invoked by nothing.
 * The file that IS invoked is `scripts/ci/bootstrap-remaining-services.sql` —
 * different directory, underscores instead of hyphens. `bootstrap_metadata.sql`
 * and `bootstrap_missing_services.sql` were orphaned outright. Consequence:
 * civitas_metadata, civitas_ml, civitas_revenue and civitas_works did not exist in
 * CI at all, so nothing about those services could be tested.
 *
 * Nothing failed, because an SQL file that is never executed cannot error.
 *
 * ── CHECK 2: every Postgres service uses a TCP health check
 *
 * The workflow used a bare `pg_isready`, which defaults to the unix socket. The
 * postgres entrypoint runs a temporary socket-only server while it executes the
 * initdb scripts, so the check passed while the container still refused TCP.
 * Measured on postgis/postgis:16-3.4: socket READY at 5s, TCP not until 50s.
 * GitHub Actions marks the service healthy on that signal and starts the job.
 *
 * The symptom is not a timeout — it is `connection refused` in a later step, which
 * reads like a flaky container rather than a lying health check.
 *
 * Also asserts the `-U <role>` in the health command matches that service's
 * POSTGRES_USER. A mismatch reintroduces the same bug in a new form: a TCP check
 * that can never pass because it names a role the container does not create.
 *
 * Usage: node scripts/ci/ci-config-guard.mjs
 * Exit: 0 clean, 1 on any violation.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const BOOTSTRAP_DIR = join(REPO_ROOT, "infra", "db", "bootstrap");
const BOOTSTRAP_SCRIPT = join(REPO_ROOT, "scripts", "ci", "bootstrap-postgres.sh");
const WORKFLOW_DIR = join(REPO_ROOT, ".github", "workflows");

/**
 * Bootstrap files that are deliberately not called by bootstrap-postgres.sh.
 * Each needs a written reason — an empty exemption is how orphans reappear.
 */
const NOT_INVOKED_BY_DESIGN = {
  "grant_service_schemas.sql":
    "parameterised helper (-v svc_role=...); invoked per-service from inside the script, not as a plain file",
  "keycloak_bootstrap.sql":
    "Keycloak realm seeding, not part of the Postgres per-service bootstrap",
};

const failures = [];
const notes = [];

// ── CHECK 1 ──────────────────────────────────────────────────────────────────
if (existsSync(BOOTSTRAP_SCRIPT) === false) {
  failures.push(`bootstrap script not found: ${BOOTSTRAP_SCRIPT}`);
} else {
  const script = readFileSync(BOOTSTRAP_SCRIPT, "utf8");
  const sqlFiles = existsSync(BOOTSTRAP_DIR)
    ? readdirSync(BOOTSTRAP_DIR).filter((f) => f.endsWith(".sql")).sort()
    : [];

  if (sqlFiles.length === 0) {
    failures.push(`no .sql files found under ${BOOTSTRAP_DIR} — the check would be vacuous`);
  }

  const orphans = [];
  for (const f of sqlFiles) {
    if (Object.prototype.hasOwnProperty.call(NOT_INVOKED_BY_DESIGN, f)) {
      notes.push(`exempt: ${f} — ${NOT_INVOKED_BY_DESIGN[f]}`);
      continue;
    }
    // Match by basename: the script references files via "$ROOT/infra/db/bootstrap/x.sql".
    if (script.includes(f) === false) orphans.push(f);
  }
  for (const f of orphans) {
    failures.push(
      `bootstrap file is invoked by nothing: infra/db/bootstrap/${f}\n` +
        `      An SQL file that is never executed cannot error, so its absence is silent.\n` +
        `      Add a run_bootstrap line in scripts/ci/bootstrap-postgres.sh, or record it\n` +
        `      in NOT_INVOKED_BY_DESIGN with a reason.`,
    );
  }

  // Guard the guard: a reference in the script pointing at a file that does not
  // exist would abort the bootstrap at runtime.
  for (const m of script.matchAll(/infra\/db\/bootstrap\/([\w.-]+\.sql)/g)) {
    if (existsSync(join(BOOTSTRAP_DIR, m[1])) === false) {
      failures.push(`bootstrap script references a missing file: infra/db/bootstrap/${m[1]}`);
    }
  }
}

// ── CHECK 2 ──────────────────────────────────────────────────────────────────
/**
 * Parsed with a line scanner rather than a YAML library so the guard has no
 * dependency and runs before `pnpm install`. The shape is rigid: a `services:`
 * block, then per-service `image:`, `env:` and `options:` keys.
 */
function postgresServicesIn(src, file) {
  const lines = src.split("\n");
  const found = [];
  let cur = null;
  const flush = () => {
    if (cur && /postgres|postgis/i.test(cur.image)) found.push(cur);
    cur = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const img = line.match(/^\s*image:\s*(\S+)/);
    if (img) {
      flush();
      cur = { file, image: img[1], options: "", user: "", line: i + 1 };
      continue;
    }
    if (cur === null) continue;
    const user = line.match(/^\s*POSTGRES_USER:\s*(\S+)/);
    if (user) cur.user = user[1];
    if (/^\s*options:\s*>-?\s*$/.test(line)) {
      // Folded scalar: consume the more-indented continuation lines.
      const indent = line.search(/\S/);
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === "") continue;
        if (lines[j].search(/\S/) <= indent) break;
        cur.options += ` ${lines[j].trim()}`;
        i = j;
      }
    } else {
      const inline = line.match(/^\s*options:\s*(.+)$/);
      if (inline) cur.options = inline[1];
    }
  }
  flush();
  return found;
}

const workflows = existsSync(WORKFLOW_DIR)
  ? readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  : [];

let pgServiceCount = 0;
for (const wf of workflows) {
  const src = readFileSync(join(WORKFLOW_DIR, wf), "utf8");
  for (const svc of postgresServicesIn(src, wf)) {
    pgServiceCount += 1;
    const where = `${svc.file}:${svc.line} (${svc.image})`;

    // A '#' inside a folded block scalar is literal text, not a comment, and would
    // be passed to `docker create` as an option. This happened while writing the
    // health-check fix.
    if (svc.options.includes("#")) {
      failures.push(
        `${where}: a '#' appears inside the options value.\n` +
          `      \`options: >-\` is a folded block scalar, so '#' is literal text and would\n` +
          `      be passed to docker as an option. Put comments ABOVE \`options:\`.`,
      );
    }

    if (/--health-cmd/.test(svc.options) === false) {
      failures.push(`${where}: no --health-cmd, so the job may start before Postgres is up.`);
      continue;
    }
    // The whole point: -h forces TCP instead of the unix socket.
    //
    // `\s-h\s` and not `-h`: the first version used `-h\s*\S+`, which matched the
    // `-h` inside `--health-interval`. So a socket-only `--health-cmd pg_isready`
    // passed this check — the guard had the very defect class it exists to catch.
    // Caught by canary C3, which failed with the wrong message rather than passing.
    if (/pg_isready[^"']*\s-h\s+\S+/.test(svc.options) === false) {
      failures.push(
        `${where}: health check does not force TCP.\n` +
          `      A bare \`pg_isready\` uses the unix socket, and the entrypoint runs a\n` +
          `      temporary socket-only server during initdb — measured on\n` +
          `      postgis/postgis:16-3.4: socket READY at 5s, TCP not until 50s. The job\n` +
          `      then starts against a server refusing connections, and fails later with\n` +
          `      'connection refused' rather than a readiness timeout.\n` +
          `      Use: --health-cmd "pg_isready -h 127.0.0.1 -p 5432 -U <POSTGRES_USER>"`,
      );
      continue;
    }
    const uFlag = svc.options.match(/pg_isready[^"']*-U\s+(\S+)/);
    if (uFlag === null) {
      failures.push(`${where}: health check has no -U <role>; it will not exercise a real login.`);
    } else if (svc.user && uFlag[1].replace(/["']/g, "") !== svc.user) {
      failures.push(
        `${where}: health check uses -U ${uFlag[1]} but POSTGRES_USER is ${svc.user}.\n` +
          `      The check can never pass — it names a role the container does not create.`,
      );
    }
  }
}

// ── CHECK 3 ──────────────────────────────────────────────────────────────────
/**
 * No CI step may pass a flag that relaxes a ratchet or rewrites its baseline.
 *
 * Every ratchet in this repo has an escape hatch, and each is legitimate where it
 * is meant to be used:
 *   --allow-stale               downgrades stale drift to INFO, for a
 *                               hand-provisioned developer cluster
 *   --write-baseline            regenerates the drift baseline
 *   BOOTSTRAP_WRITE_ALLOWLIST=1 regenerates the migration failure allow-list
 *
 * In a workflow they are all fatal to the thing they belong to. `--allow-stale` in
 * CI means a fixed-but-still-listed entry is never caught anywhere, since CI is the
 * only place the strict run happens. A baseline regenerated inside CI is worse: the
 * gate would record whatever it finds as the new normal and pass forever.
 *
 * This is the cheapest possible protection for the most expensive failure — a gate
 * that still runs, still prints its banner, and can no longer fail.
 */
const RATCHET_ESCAPE_HATCHES = [
  { pattern: "--allow-stale", why: "relaxes stale detection; CI is the only strict run" },
  { pattern: "--write-baseline", why: "rewrites the drift baseline — the gate would bless its own findings" },
  { pattern: "BOOTSTRAP_WRITE_ALLOWLIST", why: "rewrites the migration failure allow-list" },
];

let workflowLinesScanned = 0;
for (const wf of workflows) {
  const src = readFileSync(join(WORKFLOW_DIR, wf), "utf8");
  const lines = src.split("\n");
  workflowLinesScanned += lines.length;
  lines.forEach((line, idx) => {
    // Skip YAML comments: the ci.yml note explaining WHY the flag is absent must
    // not itself trip the check.
    if (line.trim().startsWith("#")) return;
    for (const hatch of RATCHET_ESCAPE_HATCHES) {
      if (line.includes(hatch.pattern)) {
        failures.push(
          `${wf}:${idx + 1}: CI step uses \`${hatch.pattern}\`.\n` +
            `      ${hatch.why}.\n` +
            `      The gate would keep running and reporting, and stop being able to fail.\n` +
            `      line: ${line.trim()}`,
        );
      }
    }
  });
}

if (workflowLinesScanned === 0) {
  failures.push("no workflow lines were scanned for ratchet escape hatches — check 3 was vacuous");
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log("──────────────────────────────────────────────────────────────");
console.log("  CI Config Guard");
console.log("──────────────────────────────────────────────────────────────");
console.log(`  bootstrap SQL files : ${existsSync(BOOTSTRAP_DIR) ? readdirSync(BOOTSTRAP_DIR).filter((f) => f.endsWith(".sql")).length : 0}`);
console.log(`  postgres services   : ${pgServiceCount}`);
for (const n of notes) console.log(`  ${n}`);
console.log("");

// A run that inspected nothing must not report success.
if (pgServiceCount === 0) {
  console.error(
    "  UNMEASURED — no Postgres service was found in any workflow. Either the\n" +
      "  workflows changed shape or the parser is broken. This is not a pass.",
  );
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`  ${failures.length} violation(s):`);
  for (const f of failures) console.error(`    ✗ ${f}`);
  console.log("──────────────────────────────────────────────────────────────");
  process.exit(1);
}

console.log("  CLEAN — every bootstrap file is invoked, every Postgres health check");
console.log("  forces TCP with a role the container actually creates, and no CI step");
console.log("  passes a flag that would stop a ratchet being able to fail.");
console.log("──────────────────────────────────────────────────────────────");
process.exit(0);
