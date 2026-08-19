/**
 * CAP-059 — reconciliation service. Wires the @civitasone/reconciliation engine
 * to real persisted sources: fetch two datasets via a provider, compare with
 * reconcile(), then persist the run + every break in one transaction.
 *
 * runReconciliation() is callable both from the HTTP route and from a scheduler
 * / queue worker (a triggered OR scheduled run), so nightly recon is a matter of
 * invoking it with a provider key on a cron.
 */
import { reconcile } from "@civitasone/reconciliation";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { getProvider } from "./providers.js";
import * as repo from "./repo.js";
import type { ReconRunRow, ReconBreakInsert } from "./schema.js";

export class ReconError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface RunResult {
  run: ReconRunRow;
  breakCount: number;
  balanced: boolean;
}

const RECON_AUDIT_TOPIC = "audit.event.record";

export async function runReconciliation(
  ctx: Pick<RequestContext, "tenantId" | "actorId">,
  providerKey: string,
  params: Record<string, unknown> = {},
  opts: { runId?: string; messageId?: string; correlationId?: string } = {},
): Promise<RunResult | null> {
  const provider = getProvider(providerKey);
  if (!provider) throw new ReconError(400, "UNKNOWN_PROVIDER", `no reconciliation provider '${providerKey}'`);

  const { source, target, config } = await provider.fetch(ctx.tenantId, params);
  const { summary, breaks } = reconcile(source, target, config);

  return db.transaction(async (tx) => {
    if (opts.messageId && !(await markProcessed(tx, opts.messageId))) return null;

    const run = await repo.insertRun(tx, {
      ...(opts.runId ? { id: opts.runId } : {}),
      tenantId: ctx.tenantId,
      provider: provider.key,
      sourceSystem: summary.sourceSystem,
      targetSystem: summary.targetSystem,
      status: "completed",
      sourceCount: summary.sourceCount,
      targetCount: summary.targetCount,
      matchedCount: summary.matchedKeys,
      breakCount: summary.breakCount,
      balanced: summary.balanced,
      params,
      completedAt: new Date(),
      triggeredBy: ctx.actorId,
    });

    const breakRows: ReconBreakInsert[] = breaks.map((b) => ({
      tenantId: ctx.tenantId,
      runId: run.id,
      provider: provider.key,
      breakKey: b.key,
      breakType: b.type,
      severity: b.severity,
      status: "open",
      ...(b.field ? { field: b.field } : {}),
      ...(b.fieldType ? { fieldType: b.fieldType } : {}),
      ...(b.sourceValue !== undefined ? { sourceValue: String(b.sourceValue) } : {}),
      ...(b.targetValue !== undefined ? { targetValue: String(b.targetValue) } : {}),
      ...(b.delta !== undefined ? { deltaMinor: BigInt(Math.round(b.delta)) } : {}),
    }));
    await repo.insertBreaks(tx, breakRows);

    const corrId = opts.correlationId ?? "";
    await enqueue(tx, {
      topic: "finance.recon.run_completed",
      eventType: "finance.recon.run_completed",
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: corrId,
      payload: { runId: run.id, balanced: summary.balanced, breakCount: summary.breakCount },
    });
    await enqueue(tx, {
      topic: RECON_AUDIT_TOPIC,
      eventType: RECON_AUDIT_TOPIC,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: corrId,
      payload: { service: "finance", action: "recon_run", resourceType: "recon_run", resourceId: run.id, outcome: "success" },
    });

    return { run, breakCount: summary.breakCount, balanced: summary.balanced };
  });
}
