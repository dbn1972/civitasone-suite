/**
 * F102 repair CLI: re-open maker-checker approvals that were consumed by a
 * super_admin self-approval before the fix.
 *
 * Before F102 the initiator (maker) holding super_admin could complete their
 * OWN approval task: workflow marked the task completed (sod_override=true,
 * decision approve) and completed the instance, the domain service then
 * refused the self-approval (maker != checker), so the record stayed pending /
 * draft with NO open task.
 *
 * Candidates (workflow DB): a maker-checker refType (tasks/sod.ts), instance
 * `completed`, and an approve task completed by the instance's own creator
 * under sod_override.
 *
 * Each candidate is then VERIFIED against procurement-service's DB (read-only
 * SELECT, tenant GUC set): it is re-opened only while the indent / PO / plan /
 * PO amendment is still awaiting approval. A record decided by other means
 * since (e.g. a direct approve) is skipped, and so is any refType this script
 * cannot verify (payroll_run).
 *
 * Re-open: the task goes back to `pending` (decision / completed_by /
 * sod_override cleared) and the instance back to `active`; a
 * `sod_repair_reopen` transition-history row and an `audit.event.record` are
 * written in the same transaction.
 *
 * Run in services/workflow-service with the worker env (DATABASE_URL as the
 * RLS-scoped workflow_svc role) plus a read connection to procurement's DB:
 *
 *   PROCUREMENT_DATABASE_URL=postgres://procurement_svc:...@host/civitas_procurement \
 *   pnpm repair:sod-consumed-approvals --tenant <uuid> [--tenant <uuid> ...] \
 *     --actor <uuid> [--instance <uuid> ...] [--dry-run]
 *
 *   --tenant    tenant to repair (repeatable; both roles are NOBYPASSRLS).
 *   --actor     user/service id recorded on the repaired rows, history, audit.
 *   --instance  limit to these instance ids (repeatable).
 *   --dry-run   only list candidates and what would be re-opened / skipped.
 *   --procurement-db-url  instead of PROCUREMENT_DATABASE_URL.
 *
 * Idempotent: a re-opened instance is `active`, so a re-run does not match it.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../shared/db.js";
import { enqueue } from "../shared/outbox.js";
import { instances } from "../modules/instances/schema.js";
import { tasks } from "../modules/tasks/schema.js";
import * as historyRepo from "../modules/history/repo.js";
import { STRICT_SOD_REF_TYPES } from "../modules/tasks/sod.js";

/** Where each verifiable refType lives in procurement's DB, and which statuses still await approval. */
const DOMAIN: Record<string, { table: string; awaiting: string[] }> = {
  procurement_indent: { table: "indent.procurement_indents", awaiting: ["pending", "tender_required"] },
  procurement_po: { table: "po.procurement_pos", awaiting: ["draft", "pending"] },
  procurement_plan: { table: "planning.procurement_plans", awaiting: ["pending"] },
  procurement_po_amendment: { table: "po.procurement_po_amendments", awaiting: ["pending"] },
};

/** Reads a domain record's status; `null` = not found for this tenant. */
export type DomainStatusReader = (tenantId: string, refType: string, refId: string) => Promise<string | null>;

/** Read-only status reader over procurement-service's DB (tenant GUC set per read). */
export function procurementStatusReader(url: string): { read: DomainStatusReader; end: () => Promise<void> } {
  const pg = postgres(url, { max: 1 });
  const read: DomainStatusReader = async (tenantId, refType, refId) => {
    const d = DOMAIN[refType];
    if (!d) throw new Error(`unverifiable refType ${refType}`);
    const rows = await pg.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.unsafe(`SELECT status FROM ${d.table} WHERE id = $1::uuid AND tenant_id = $2::uuid`, [refId, tenantId]);
    });
    const row = (rows as unknown as Array<{ status: string }>)[0];
    return row ? row.status : null;
  };
  return { read, end: () => pg.end() };
}

const argsSchema = z.object({
  tenants: z.array(z.string().uuid()).min(1),
  actor: z.string().uuid(),
  instances: z.array(z.string().uuid()),
  dryRun: z.boolean(),
  procurementDbUrl: z.string().min(1, "PROCUREMENT_DATABASE_URL (or --procurement-db-url) is required to verify domain records"),
});

function parseArgs(argv: string[]): z.infer<typeof argsSchema> {
  const tenants: string[] = [];
  const ids: string[] = [];
  let actor = "";
  let dryRun = false;
  let procurementDbUrl = process.env.PROCUREMENT_DATABASE_URL ?? "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tenant") tenants.push(argv[++i] ?? "");
    else if (a === "--actor") actor = argv[++i] ?? "";
    else if (a === "--instance") ids.push(argv[++i] ?? "");
    else if (a === "--procurement-db-url") procurementDbUrl = argv[++i] ?? "";
    else if (a === "--dry-run") dryRun = true;
    else if (a !== "--") throw new Error(`unknown argument: ${a}`);
  }
  return argsSchema.parse({ tenants, actor, instances: ids, dryRun, procurementDbUrl });
}

export type RepairCandidate = {
  instanceId: string; taskId: string; refType: string | null; refId: string | null; makerId: string; domainStatus: string | null;
};
export type RepairResult = {
  candidates: RepairCandidate[];
  reopened: string[];
  skipped: Array<{ instanceId: string; reason: string }>;
};

export async function repairSodConsumedApprovals(
  tenantId: string,
  opts: { actorId: string; readDomainStatus: DomainStatusReader; dryRun?: boolean; instanceIds?: string[] },
): Promise<RepairResult> {
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select({
    instanceId: instances.id, taskId: tasks.id, refType: instances.refType, refId: instances.refId,
    makerId: instances.createdBy, completedBy: tasks.completedBy,
  }).from(tasks).innerJoin(instances, eq(instances.id, tasks.instanceId)).where(and(
    eq(instances.tenantId, tenantId),
    eq(instances.status, "completed"),
    inArray(instances.refType, [...STRICT_SOD_REF_TYPES]),
    eq(tasks.status, "completed"),
    eq(tasks.decision, "approve"),
    eq(tasks.sodOverride, true),
    ...(opts.instanceIds && opts.instanceIds.length ? [inArray(instances.id, opts.instanceIds)] : []),
  ))));

  const candidates: RepairCandidate[] = [];
  const skipped: RepairResult["skipped"] = [];
  const toReopen: RepairCandidate[] = [];
  for (const r of rows) {
    if (r.completedBy == null || r.completedBy !== r.makerId) continue;
    const base = { instanceId: r.instanceId, taskId: r.taskId, refType: r.refType, refId: r.refId, makerId: r.makerId };
    if (!r.refType || !r.refId || !DOMAIN[r.refType]) {
      candidates.push({ ...base, domainStatus: null });
      skipped.push({ instanceId: r.instanceId, reason: "domain_unverifiable" });
      continue;
    }
    // Read the domain record outside the workflow transaction (different DB).
    const domainStatus = await opts.readDomainStatus(tenantId, r.refType, r.refId);
    const c = { ...base, domainStatus };
    candidates.push(c);
    if (domainStatus == null) skipped.push({ instanceId: r.instanceId, reason: "domain_record_missing" });
    else if (!DOMAIN[r.refType]!.awaiting.includes(domainStatus)) skipped.push({ instanceId: r.instanceId, reason: `already_decided:${domainStatus}` });
    else toReopen.push(c);
  }
  if (opts.dryRun || toReopen.length === 0) return { candidates, reopened: [], skipped };

  const reopened = await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const done: string[] = [];
    for (const c of toReopen) {
      const now = new Date();
      const t = await tx.update(tasks).set({
        status: "pending", decision: null, completedBy: null, sodOverride: false, updatedBy: opts.actorId, updatedAt: now,
      }).where(and(eq(tasks.id, c.taskId), eq(tasks.status, "completed"))).returning({ id: tasks.id });
      const i = await tx.update(instances).set({ status: "active", updatedBy: opts.actorId, updatedAt: now })
        .where(and(eq(instances.id, c.instanceId), eq(instances.status, "completed"))).returning({ id: instances.id });
      if (t.length === 0 || i.length === 0) throw new Error(`instance ${c.instanceId} changed during repair; re-run`);
      await historyRepo.record(tx, {
        tenantId, instanceId: c.instanceId, taskId: c.taskId, fromNode: null, toNode: null,
        action: "sod_repair_reopen", decision: null, actorId: opts.actorId,
        detail: { reason: "F102: approval consumed by the maker's own super_admin override; re-opened for a checker", makerId: c.makerId, domainStatus: c.domainStatus },
      });
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId, actorId: opts.actorId, correlationId: randomUUID(),
        payload: {
          service: "workflow", action: "sod_repair_reopen", resourceType: "instance", resourceId: c.instanceId, outcome: "success",
          metadata: { taskId: c.taskId, refType: c.refType, refId: c.refId, makerId: c.makerId, domainStatus: c.domainStatus },
        },
      });
      done.push(c.instanceId);
    }
    return done;
  }));
  return { candidates, reopened, skipped };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const reader = procurementStatusReader(args.procurementDbUrl);
  try {
    for (const tenantId of args.tenants) {
      const r = await repairSodConsumedApprovals(tenantId, {
        actorId: args.actor, dryRun: args.dryRun, instanceIds: args.instances, readDomainStatus: reader.read,
      });
      process.stdout.write(`${JSON.stringify({ tenantId, dryRun: args.dryRun, ...r })}\n`);
    }
  } finally {
    await reader.end();
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
