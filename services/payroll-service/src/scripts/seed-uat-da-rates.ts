/**
 * B10 (UAT) ops CLI: seed the standard 7th CPC Dearness Allowance series
 * (modules/payroll/da-rate-seed.ts) into tenants that have NO DA rate rows, so
 * payroll runs stop failing with DA_RATE_NOT_CONFIGURED. Idempotent: a tenant
 * with any DA row is skipped; a re-run changes nothing. Rows are labelled as
 * UAT seed data (order_ref).
 *
 * Run in the payroll-service package directory with the payroll worker's env
 * (DATABASE_URL as the RLS-scoped payroll_svc role):
 *
 *   pnpm payroll:seed-uat-da-rates --tenant <uuid> [--tenant <uuid> ...] \
 *     [--actor <uuid>] [--dry-run]
 *
 *   --tenant   tenant to seed (repeatable, required: payroll_svc is
 *              NOBYPASSRLS, so the script never enumerates tenants).
 *   --actor    id recorded on the audit event (default: the system actor).
 *   --dry-run  only report what would be written.
 */
import { z } from "zod";
import { sqlClient } from "../shared/db.js";
import { seedUatDaRates } from "../modules/payroll/da-rate-seed.js";

const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

const argsSchema = z.object({
  tenants: z.array(z.string().uuid()).min(1),
  actor: z.string().uuid(),
  dryRun: z.boolean(),
});

function parseArgs(argv: string[]): z.infer<typeof argsSchema> {
  const tenants: string[] = [];
  let actor = SYSTEM_ACTOR;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tenant") tenants.push(argv[++i] ?? "");
    else if (a === "--actor") actor = argv[++i] ?? "";
    else if (a === "--dry-run") dryRun = true;
    else if (a !== "--") throw new Error(`unknown argument: ${a}`);
  }
  return argsSchema.parse({ tenants, actor, dryRun });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const tenantId of args.tenants) {
    const r = await seedUatDaRates(tenantId, { actorId: args.actor, dryRun: args.dryRun });
    process.stdout.write(`${JSON.stringify(r)}\n`);
  }
}

main()
  .then(() => sqlClient.end())
  .catch(async (err: unknown) => {
    process.stderr.write(`seed-uat-da-rates failed: ${err instanceof Error ? err.message : String(err)}\n`);
    await sqlClient.end();
    process.exit(1);
  });
