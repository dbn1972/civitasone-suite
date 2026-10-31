/**
 * F102 repair CLI: re-open maker-checker approvals that were consumed by a
 * super_admin self-approval before the fix.
 *
 * Before F102 the initiator (maker) holding super_admin could complete their
 * OWN approval task: workflow marked the task completed (sod_override=true,
 * decision approve) and completed the instance, the domain service then
 * refused the self-approval (maker != checker), so the record stayed pending /
 * draft with NO open task. This finds exactly those instances - a
 * maker-checker refType (tasks/sod.ts), instance `completed`, and an approve
 * task completed by the instance's own creator under sod_override - and
 * re-opens them: the task goes back to `pending` (decision / completed_by /
 * sod_override cleared) and the instance back to `active`, with a
 * `sod_repair_reopen` transition-history row. A real checker can then decide.
 *
 * The domain refused every such approval (that is the defect), so the record
 * is still awaiting approval; cross-check the printed refIds against the
 * domain DB before a real run if in doubt (indent `pending`, PO `draft`).
 *
 * Run in services/workflow-service with the worker env (DATABASE_URL as the
 * RLS-scoped workflow_svc role):
 *
 *   pnpm repair:sod-consumed-approvals --tenant <uuid> [--tenant <uuid> ...] \
 *     --actor <uuid> [--instance <uuid> ...] [--dry-run]
 *
 *   --tenant    tenant to repair (repeatable; workflow_svc is NOBYPASSRLS).
 *   --actor     user/service id recorded on the repaired rows and history.
 *   --instance  limit to these instance ids (repeatable).
 *   --dry-run   only list what would be re-opened.
 *
 * Idempotent: a re-opened instance is `active`, so a re-run does not match it.
 */
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../shared/db.js";
import { instances } from "../modules/instances/schema.js";
import { tasks } from "../modules/tasks/schema.js";
import * as historyRepo from "../modules/history/repo.js";
import { STRICT_SOD_REF_TYPES } from "../modules/tasks/sod.js";

const argsSchema = z.object({
  tenants: z.array(z.string().uuid()).min(1),
  actor: z.string().uuid(),
  instances: z.array(z.string().uuid()),
  dryRun: z.boolean(),
});

function parseArgs(argv: string[]): z.infer<typeof argsSchema> {
  const tenants: string[] = [];
  const ids: string[] = [];
  let actor = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tenant") tenants.push(argv[++i] ?? "");
    else if (a === "--actor") actor = argv[++i] ?? "";
    else if (a === "--instance") ids.push(argv[++i] ?? "");
    else if (a === "--dry-run") dryRun = true;
    else if (a !== "--") throw new Error(`unknown argument: ${a}`);
  }
  return argsSchema.parse({ tenants, actor, instances: ids, dryRun });
}

export type RepairCandidate = { instanceId: string; taskId: string; refType: string | null; refId: string | null; makerId: string };

export async function repairSodConsumedApprovals(
  tenantId: string,
  opts: { actorId: string; dryRun?: boolean; instanceIds?: string[] },
): Promise<{ candidates: RepairCandidate[]; reopened: string[] }> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const rows = await tx.select({
      instanceId: instances.id, taskId: tasks.id, refType: instances.refType, refId: instances.refId,
      makerId: instances.createdBy, currentNode: instances.currentNode, completedBy: tasks.completedBy,
    }).from(tasks).innerJoin(instances, eq(instances.id, tasks.instanceId)).where(and(
      eq(instances.tenantId, tenantId),
      eq(instances.status, "completed"),
      inArray(instances.refType, [...STRICT_SOD_REF_TYPES]),
      eq(tasks.status, "completed"),
      eq(tasks.decision, "approve"),
      eq(tasks.sodOverride, true),
      ...(opts.instanceIds && opts.instanceIds.length ? [inArray(instances.id, opts.instanceIds)] : []),
    ));
    const candidates = rows
      .filter((r) => r.completedBy != null && r.completedBy === r.makerId)
      .map(({ instanceId, taskId, refType, refId, makerId }) => ({ instanceId, taskId, refType, refId, makerId }));
    if (opts.dryRun) return { candidates, reopened: [] };
    const reopened: string[] = [];
    for (const c of candidates) {
      const now = new Date();
      await tx.update(tasks).set({
        status: "pending", decision: null, completedBy: null, sodOverride: false, updatedBy: opts.actorId, updatedAt: now,
      }).where(and(eq(tasks.id, c.taskId), eq(tasks.status, "completed")));
      await tx.update(instances).set({ status: "active", updatedBy: opts.actorId, updatedAt: now })
        .where(and(eq(instances.id, c.instanceId), eq(instances.status, "completed")));
      await historyRepo.record(tx, {
        tenantId, instanceId: c.instanceId, taskId: c.taskId, fromNode: null, toNode: null,
        action: "sod_repair_reopen", decision: null, actorId: opts.actorId,
        detail: { reason: "F102: approval consumed by the maker's own super_admin override; re-opened for a checker", makerId: c.makerId },
      });
      reopened.push(c.instanceId);
    }
    return { candidates, reopened };
  }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  for (const tenantId of args.tenants) {
    const r = await repairSodConsumedApprovals(tenantId, { actorId: args.actor, dryRun: args.dryRun, instanceIds: args.instances });
    process.stdout.write(`${JSON.stringify({ tenantId, dryRun: args.dryRun, ...r })}\n`);
  }
}

if (process.argv[1] && /repair-sod-consumed-approvals\.[tj]s$/.test(process.argv[1])) {
  main()
    .then(() => sqlClient.end())
    .catch(async (err: unknown) => {
      process.stderr.write(`repair-sod-consumed-approvals failed: ${err instanceof Error ? err.message : String(err)}\n`);
      await sqlClient.end();
      process.exit(1);
    });
}
