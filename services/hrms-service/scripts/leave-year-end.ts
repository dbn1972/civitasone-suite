/**
 * UAT T-PERIOD D-14 (ERP-head decision 2026-11-05): run the CCS (Leave) Rules
 * leave year-end / half-yearly credit for one credit date (1 Jan / 1 Jul; 1 Apr
 * / 1 Oct for a tenant on a financial leave year) -- the same job the worker
 * runs when HRMS_LEAVE_YEAR_END_ENABLED=true (modules/leave/year-end-job.ts).
 *
 *   --dry-run (DEFAULT): print the plan (carry-forward, 300-day lapse, credit,
 *                        CL lapse per employee); writes nothing.
 *   --apply            : apply it (idempotent: an employee + leave type already
 *                        processed for the date is skipped). Needs --actor.
 *   --tenant <uuid>    : the tenant (required, repeatable).
 *   --run-date <date>  : the credit date, YYYY-MM-DD (required).
 *   --actor <uuid>     : the HR officer the change is recorded against (--apply).
 *
 * Usage (from services/hrms-service, with the hrms-service runtime env):
 *   pnpm exec tsx scripts/leave-year-end.ts --tenant <uuid> --run-date 2027-01-01
 *   pnpm exec tsx scripts/leave-year-end.ts --apply --actor <uuid> --tenant <uuid> --run-date 2027-01-01
 * Prints one JSON line per tenant (employee ids / numbers and days only).
 * NOT to be run on the live UAT without the owner reviewing the dry run.
 */
import { pathToFileURL } from "node:url";
import { db, sqlClient } from "../src/shared/db.js";
import { planLeaveYearEnd, type LeaveYearEndResult } from "../src/modules/leave/year-end-job.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface LeaveYearEndArgs { dryRun: boolean; tenants: string[]; runDate: string; actor: string | null }

export function parseArgs(argv: string[]): LeaveYearEndArgs {
  let apply = false, dry = false, actor: string | null = null, runDate: string | null = null;
  const tenants: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") dry = true;
    else if (a === "--tenant") {
      const v = argv[++i];
      if (!v || !UUID_RE.test(v)) throw new Error("--tenant needs a tenant uuid");
      tenants.push(v);
    } else if (a === "--actor") {
      const v = argv[++i];
      if (!v || !UUID_RE.test(v)) throw new Error("--actor needs the HR officer user uuid");
      actor = v;
    } else if (a === "--run-date") {
      const v = argv[++i];
      if (!v || !DATE_RE.test(v)) throw new Error("--run-date needs YYYY-MM-DD");
      runDate = v;
    } else throw new Error(`unknown argument ${a} (use --dry-run | --apply | --tenant <uuid> | --run-date <YYYY-MM-DD> | --actor <uuid>)`);
  }
  if (apply && dry) throw new Error("--apply and --dry-run are exclusive");
  if (tenants.length === 0) throw new Error("--tenant <uuid> is required");
  if (!runDate) throw new Error("--run-date <YYYY-MM-DD> is required");
  if (apply && !actor) throw new Error("--apply needs --actor <uuid>");
  return { dryRun: !apply, tenants, runDate, actor };
}

export async function runLeaveYearEnd(args: LeaveYearEndArgs): Promise<LeaveYearEndResult[]> {
  const out: LeaveYearEndResult[] = [];
  for (const tenantId of args.tenants) {
    out.push(await planLeaveYearEnd(db, { tenantId, runDate: args.runDate, dryRun: args.dryRun, ...(args.actor ? { actorId: args.actor } : {}) }));
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    for (const r of await runLeaveYearEnd(args)) console.log(JSON.stringify(r));
  } finally {
    await sqlClient.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
