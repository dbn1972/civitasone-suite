#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-fleet-reconciled.mjs — deployment-runbook Verify step (Issue #3)
//
// Is every app declared in ecosystem.config.js actually known to PM2 and
// "online" RIGHT NOW on this host?
//
// WHY THIS EXISTS
// -----------------
// scripts/deployment-runbook.md's Deploy step used to run only `pm2 restart
// all`, which only restarts processes PM2 already knows about — it never
// starts anything newly declared in ecosystem.config.js that isn't already a
// running PM2 process. Measured 2026-09-22: 100 of 132 declared apps were not
// running on this host despite nothing structurally blocking them (no error,
// no signal — `pm2 restart all` exits 0 either way). The Deploy step now also
// runs `pm2 start ecosystem.config.js` afterward, verified live (see that
// doc's Deploy section and the PR that introduced this file for the
// evidence) to safely reconcile: it restarts every already-known app in
// place (no duplication) AND starts every not-yet-known one. `pm2 restart
// all` is kept rather than replaced because, unlike `pm2 start
// ecosystem.config.js`, it needs no secrets in the invoking shell (see the
// Deploy section for why) — so the already-known apps still get the new
// build even on a deploy where reconciliation itself can't proceed.
//
// But `pm2 start`/`pm2 restart` returning exit 0 does NOT mean a process
// stayed up — a newly-started app can crash immediately after launch (a
// missing secret, an unbuilt dependency, a role/database that was never
// provisioned — see docs/runbooks/launch-undeployed-services.md's
// Troubleshooting table for real examples) and PM2 still reports success for
// the *start action*, not the process's actual health. This script is the
// independent, loud check that closes THAT gap too: it re-derives the full
// intended fleet from ecosystem.config.js itself (never a hand-maintained
// number — see scripts/ops/lib/fleet-topology.mjs, PERF-001, which this
// reuses) and fails non-zero, by name, if anything declared is missing from
// PM2 entirely, present but not "online", or — as a cheap independent
// tripwire — running more than once under the same name.
//
// This is a LIVE, host-side check, not a CI static-analysis guard: it shells
// out to the real `pm2 jlist`, which requires a running pm2 daemon that CI
// does not have. Contrast scripts/ci/deployment-declaration-guard.mjs, which
// is deliberately static (source-vs-source only) and explicitly defers
// runtime-running checks to "the L0 readiness lane" / here. Run this on the
// host, right after `pm2 start ecosystem.config.js` — see
// scripts/deployment-runbook.md's Verify step.
//
// Usage: node scripts/ops/verify-fleet-reconciled.mjs
// Exit:  0 — every declared app is online, exactly once.
//        1 — at least one declared app is missing, not online, or duplicated
//            (names printed).
//        2 — tooling error (couldn't parse ecosystem.config.js, or couldn't
//            run `pm2 jlist`) — refuses to report a false pass.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { loadFleetTopology } from "./lib/fleet-topology.mjs";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

/**
 * Pure diff: given the full set of app names declared in ecosystem.config.js
 * and the current PM2 process list (as parsed from `pm2 jlist`), return which
 * declared names are missing entirely, which are known but not "online", and
 * which have more than one "online" instance under the same name.
 *
 * Exported for unit testing without a live pm2 daemon
 * (tests/ops/verify-fleet-reconciled.test.ts) — mirrors the shape of
 * scripts/ops/verify-pgbouncer-routing.mjs's exported `classifyFleet()`.
 *
 * @param {string[]} declaredNames
 * @param {Array<{name?: string, pm2_env?: {status?: string}}>} pm2Processes
 */
export function diffFleet(declaredNames, pm2Processes) {
  const onlineCount = new Map(); // name -> count of "online" instances
  const firstNonOnlineStatus = new Map(); // name -> status of the first non-online instance seen

  for (const p of pm2Processes ?? []) {
    const name = p?.name;
    const status = p?.pm2_env?.status;
    if (!name) continue;
    if (status === "online") {
      onlineCount.set(name, (onlineCount.get(name) ?? 0) + 1);
    } else if (!firstNonOnlineStatus.has(name)) {
      firstNonOnlineStatus.set(name, status ?? "unknown");
    }
  }

  const missing = [];
  const notOnline = [];
  for (const name of declaredNames) {
    if (onlineCount.has(name)) continue;
    if (firstNonOnlineStatus.has(name)) {
      notOnline.push({ name, status: firstNonOnlineStatus.get(name) });
    } else {
      missing.push(name);
    }
  }

  const duplicated = [...onlineCount.entries()].filter(([, count]) => count > 1).map(([name]) => name);

  return { missing, notOnline, duplicated };
}

function main() {
  let processNames;
  try {
    ({ processNames } = loadFleetTopology());
  } catch (err) {
    console.error(`${RED}verify-fleet-reconciled: could not load ecosystem.config.js — ${err?.message || err}${RESET}`);
    process.exit(2);
  }
  if (!Array.isArray(processNames) || processNames.length < 30) {
    console.error(
      `${RED}verify-fleet-reconciled: only ${processNames?.length ?? 0} app name(s) read from ` +
        `ecosystem.config.js — the parser looks broken. Refusing to report a false pass.${RESET}`,
    );
    process.exit(2);
  }

  let pm2Processes;
  try {
    const raw = execFileSync("pm2", ["jlist"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15000,
    });
    pm2Processes = JSON.parse(raw);
  } catch (err) {
    console.error(`${RED}verify-fleet-reconciled: could not read \`pm2 jlist\` — ${err?.message || err}${RESET}`);
    process.exit(2);
  }

  const { missing, notOnline, duplicated } = diffFleet(processNames, pm2Processes);
  const onlineExactlyOnce = processNames.length - missing.length - notOnline.length;

  console.log(`${BOLD}verify-fleet-reconciled${RESET}: ${processNames.length} apps declared in ecosystem.config.js`);
  console.log(`  online now       : ${onlineExactlyOnce}`);
  console.log(`  missing entirely : ${missing.length}`);
  console.log(`  known but down   : ${notOnline.length}`);
  console.log(`  duplicated       : ${duplicated.length}`);

  if (missing.length === 0 && notOnline.length === 0 && duplicated.length === 0) {
    console.log(`\n${GREEN}PASS${RESET} — every app declared in ecosystem.config.js is online, exactly once.`);
    process.exit(0);
  }

  if (missing.length > 0) {
    console.error(`\n${RED}MISSING — declared in ecosystem.config.js but PM2 has never heard of them:${RESET}`);
    for (const n of missing) console.error(`  ${n}`);
    console.error(
      "  This is the exact drift class this check exists to catch. Re-run\n" +
        "  `pm2 start ecosystem.config.js`, or start one at a time with\n" +
        "  `pm2 start ecosystem.config.js --only <name>` and read its output —\n" +
        "  see docs/runbooks/launch-undeployed-services.md if it needs secrets\n" +
        "  or a role/database that was never provisioned.",
    );
  }
  if (notOnline.length > 0) {
    console.error(`\n${RED}NOT ONLINE — PM2 knows about them but they are not "online":${RESET}`);
    for (const { name, status } of notOnline) console.error(`  ${name} (${status})`);
    console.error(
      "  A `pm2 start`/`restart` exit code of 0 does not mean the process\n" +
        "  stayed up. Check `pm2 logs <name> --err --lines 100 --nostream` for\n" +
        "  the real startup error.",
    );
  }
  if (duplicated.length > 0) {
    console.error(`\n${RED}DUPLICATED — more than one online instance under the same name:${RESET}`);
    for (const n of duplicated) console.error(`  ${n}`);
  }
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
