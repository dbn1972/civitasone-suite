/**
 * GAP-PAYROLL-REGISTER-WRITER backfill CLI: writes payroll.payroll_register
 * rows for a tenant's approved/disbursed runs computed before the
 * register writer existed. Idempotent: safe to re-run. Also the repair for
 * department rows shown as "Unassigned" because HRMS employee-summaries was
 * unavailable when the run was computed: re-run with --rebuild.
 *
 * Run in the payroll-service package directory, against the target environment, with
 * the same env the payroll worker uses (DATABASE_URL as the RLS-scoped
 * payroll_svc role, HRMS_URL, INTERNAL_SERVICE_SECRET):
 *
 *   pnpm backfill:payroll-register --tenant <uuid> [--tenant <uuid> ...] \
 *     --actor <uuid> [--dry-run] [--rebuild]
 *
 *   --tenant   tenant to backfill (repeatable). Required: payroll_svc is
 *              NOBYPASSRLS, so the script never enumerates tenants itself.
 *   --actor    user/service id recorded on the audit event of each run.
 *   --dry-run  only report what would be written.
 *   --rebuild  also rebuild runs that already have register rows.
 */
import { z } from "zod";
import { sqlClient } from "../shared/db.js";
import { backfillPayrollRegister } from "../modules/payroll/register-backfill.js";

const argsSchema = z.object({
  tenants: z.array(z.string().uuid()).min(1),
  actor: z.string().uuid(),
  dryRun: z.boolean(),
  rebuild: z.boolean(),
});

function parseArgs(argv: string[]): z.infer<typeof argsSchema> {
  const tenants: string[] = [];
  let actor = "";
  let dryRun = false;
  let rebuild = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tenant") tenants.push(argv[++i] ?? "");
    else if (a === "--actor") actor = argv[++i] ?? "";
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--rebuild") rebuild = true;
    else if (a !== "--") throw new Error(`unknown argument: ${a}`);
  }
  return argsSchema.parse({ tenants, actor, dryRun, rebuild });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const tenantId of args.tenants) {
    const r = await backfillPayrollRegister(tenantId, { actorId: args.actor, dryRun: args.dryRun, rebuild: args.rebuild });
    process.stdout.write(`${JSON.stringify({ tenantId, dryRun: args.dryRun, ...r })}\n`);
  }
}

main()
  .then(() => sqlClient.end())
  .catch(async (err: unknown) => {
    process.stderr.write(`backfill-payroll-register failed: ${err instanceof Error ? err.message : String(err)}\n`);
    await sqlClient.end();
    process.exit(1);
  });
