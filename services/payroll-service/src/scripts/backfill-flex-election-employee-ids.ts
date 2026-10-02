/**
 * CLI for the one-off flex-election employee-id repair (see
 * modules/payroll/flex-election-backfill.ts and docs/runbooks/payroll.md).
 *
 *   tsx src/scripts/backfill-flex-election-employee-ids.ts --tenant <uuid>
 *   tsx src/scripts/backfill-flex-election-employee-ids.ts --tenant <uuid> --apply --actor <operator-user-uuid>
 *
 * Dry run unless --apply. One tenant per invocation. Prints a JSON report.
 * Exit codes: 0 ok, 1 error (incl. HRMS unreachable: nothing written),
 * 2 finished but some rows need a human decision (conflict/unlinked).
 */
import { backfillFlexElectionEmployeeIds } from "../modules/payroll/flex-election-backfill.js";
import { sqlClient } from "../shared/db.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const tenantId = arg("--tenant");
  if (!tenantId) {
    process.stderr.write("usage: --tenant <uuid> [--apply --actor <uuid>]\n");
    return 1;
  }
  const report = await backfillFlexElectionEmployeeIds({
    tenantId, apply: process.argv.includes("--apply"), actorId: arg("--actor"),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.conflicts + report.unlinked > 0 ? 2 : 0;
}

main()
  .then(async (code) => { await sqlClient.end(); process.exit(code); })
  .catch(async (err: unknown) => {
    process.stderr.write(`backfill failed, nothing written: ${err instanceof Error ? err.message : String(err)}\n`);
    await sqlClient.end();
    process.exit(1);
  });
