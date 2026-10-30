/**
 * F77 backfill CLI: seeds the standard workflow definitions (catalog.ts) into
 * existing tenants that lack them, e.g. `procurement_po_approval`, without
 * which every PO approval instance is rejected as `unknown_definition` and a
 * PO can never be approved. Idempotent: only codes with no row for the tenant
 * are written; active, draft and archived definitions are never touched.
 *
 * Run in the workflow-service package directory, against the target
 * environment, with the same env the workflow worker uses (DATABASE_URL as the
 * RLS-scoped workflow_svc role):
 *
 *   pnpm backfill:workflow-definitions --tenant <uuid> [--tenant <uuid> ...] \
 *     --actor <uuid> [--code <code> ...] [--dry-run]
 *
 *   --tenant   tenant to backfill (repeatable). Required: workflow_svc is
 *              NOBYPASSRLS, so the script never enumerates tenants itself.
 *   --actor    user/service id recorded as created_by and on the audit event.
 *   --code     limit to these catalogue codes (repeatable). Default: every
 *              code enabled by WORKFLOW_SEED_CLUSTERS (what tenant.created seeds).
 *   --dry-run  only report what would be written.
 */
import { z } from "zod";
import { sqlClient } from "../shared/db.js";
import { backfillStandardDefinitions, selectDefinitions } from "../modules/provisioning/backfill.js";

const argsSchema = z.object({
  tenants: z.array(z.string().uuid()).min(1),
  actor: z.string().uuid(),
  codes: z.array(z.string().min(1).max(64)),
  dryRun: z.boolean(),
});

function parseArgs(argv: string[]): z.infer<typeof argsSchema> {
  const tenants: string[] = [];
  const codes: string[] = [];
  let actor = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tenant") tenants.push(argv[++i] ?? "");
    else if (a === "--actor") actor = argv[++i] ?? "";
    else if (a === "--code") codes.push(argv[++i] ?? "");
    else if (a === "--dry-run") dryRun = true;
    else if (a !== "--") throw new Error(`unknown argument: ${a}`);
  }
  return argsSchema.parse({ tenants, actor, codes, dryRun });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const defs = selectDefinitions(args.codes);
  for (const tenantId of args.tenants) {
    const r = await backfillStandardDefinitions(tenantId, { actorId: args.actor, dryRun: args.dryRun, defs });
    process.stdout.write(`${JSON.stringify({ tenantId, dryRun: args.dryRun, ...r })}\n`);
  }
}

main()
  .then(() => sqlClient.end())
  .catch(async (err: unknown) => {
    process.stderr.write(`backfill-standard-definitions failed: ${err instanceof Error ? err.message : String(err)}\n`);
    await sqlClient.end();
    process.exit(1);
  });
