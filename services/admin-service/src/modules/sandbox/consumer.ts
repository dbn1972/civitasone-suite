/**
 * WC-009 — sandbox masked-refresh consumer.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  THIS IS THE STUB BOUNDARY. NO DATA IS MOVED.
 * ════════════════════════════════════════════════════════════════════════════
 * `copyMaskedData()` below is the one and only place where a real deployment
 * would read from the source environment and write masked rows into the sandbox.
 * In this build it performs no I/O and returns immediately, and the job records
 * `dataMovement = 'stubbed'` so no reader can mistake the orchestration for an
 * actual refresh. Everything AROUND the stub is real: approval gating, the
 * fail-closed masking plan, the record of what was masked, status tracking,
 * audit, and the completion event.
 *
 * Division of labour with the route: `POST .../approve` wrote the job's approval
 * columns and set it to `queued`. This consumer writes only the LATER facts —
 * started/completed timestamps, the resolved plan counts, and the masked-field
 * rows — so it never re-writes what the route already wrote.
 *
 * Consumers run outside an HTTP request, so there is no app.tenant_id GUC and
 * the tables are FORCE RLS: all DB work is wrapped in runWithTenant().
 * markProcessed() is the FIRST statement in the transaction.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { auditEvent, domainEvent } from "../../shared/audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { buildMaskingPlan, type MaskingRule, type MaskingPlan } from "./domain.js";

const log = pino({ name: "admin-sandbox-consumer" });

export interface RefreshExecuteMessage {
  messageId: string;
  tenantId: string;
  actorId: string;
  correlationId: string;
  payload: { jobId: string; sandboxId: string; tenantId?: string };
}

/**
 * STUB: the real masked copy. A production implementation would stream rows
 * from the source environment, apply `plan` per field, and write into the
 * sandbox target. It intentionally receives only field NAMES and strategies, so
 * it is structurally unable to log a masked value.
 */
async function copyMaskedData(_plan: MaskingPlan): Promise<{ moved: "stubbed" }> {
  // Deliberately empty — see the header. Do not "implement" this without a
  // security review of the source-environment credentials path.
  return { moved: "stubbed" };
}

export async function handleSandboxRefreshExecute(msg: RefreshExecuteMessage): Promise<void> {
  try {
    await runWithTenant(msg.tenantId, async () => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const w = tx as repo.Writer;
        const job = await repo.findRefreshJobTx(w, msg.tenantId, msg.payload.jobId);
        if (!job) {
          log.warn({ messageId: msg.messageId, jobId: msg.payload.jobId }, "sandbox refresh job not found");
          return;
        }
        if (job.status !== "queued") {
          log.info(
            { messageId: msg.messageId, jobId: job.id, status: job.status },
            "sandbox refresh skipped: job is not queued",
          );
          return;
        }

        const ruleRows = await repo.listMaskingRulesTx(w, msg.tenantId, job.sandboxId);
        const rules: MaskingRule[] = ruleRows.map((r) => ({
          tableName: r.tableName,
          fieldName: r.fieldName,
          strategy: r.strategy as MaskingRule["strategy"],
          justification: r.justification,
        }));
        // Fail-closed: any requested field without a rule resolves to `redact`.
        const plan = buildMaskingPlan(job.requestedFields, rules);

        const outcome = await copyMaskedData(plan);

        const now = new Date();
        await repo.insertMaskedFields(w, plan.fields.map((f) => ({
          tenantId: msg.tenantId,
          jobId: job.id,
          tableName: f.tableName,
          fieldName: f.fieldName,
          strategy: f.strategy,
          ruleSource: f.ruleSource,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        })));

        const closed = await repo.updateRefreshJob(w, msg.tenantId, job.id, job.version, {
          status: "completed",
          startedAt: now,
          completedAt: now,
          dataMovement: outcome.moved,
          maskedFieldCount: plan.maskedFieldCount,
          preservedFieldCount: plan.preservedFieldCount,
          updatedBy: msg.actorId,
        });
        if (!closed) {
          // Someone moved the job between our read and write — abort the whole
          // transaction rather than half-applying it.
          throw new Error(`sandbox refresh ${job.id}: version conflict closing job`);
        }

        const sandbox = await repo.findSandboxTx(w, msg.tenantId, job.sandboxId);
        if (sandbox) {
          await repo.updateSandboxStatus(w, msg.tenantId, sandbox.id, sandbox.version, {
            status: "ready", lastRefreshAt: now, updatedBy: msg.actorId,
          });
        }

        const ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
        await domainEvent(tx, ctx, EVENTS.sandboxRefreshCompleted, {
          jobId: job.id,
          sandboxId: job.sandboxId,
          maskedFieldCount: plan.maskedFieldCount,
          preservedFieldCount: plan.preservedFieldCount,
          dataMovement: outcome.moved,
        });
        await auditEvent(tx, ctx, "sandbox_refresh.completed", "sandbox_refresh", job.id, {
          maskedFieldCount: plan.maskedFieldCount,
          preservedFieldCount: plan.preservedFieldCount,
          dataMovement: outcome.moved,
        });
        // Counts and field names only — never a masked value.
        log.info(
          {
            messageId: msg.messageId,
            jobId: job.id,
            maskedFieldCount: plan.maskedFieldCount,
            preservedFieldCount: plan.preservedFieldCount,
            dataMovement: outcome.moved,
          },
          "sandbox refresh orchestration completed (data movement stubbed)",
        );
      });
    });
  } catch (err) {
    log.error(
      { err, messageId: msg.messageId, type: COMMANDS.sandboxRefreshExecute },
      "Consumer processing failed",
    );
  }
}

export function registerSandboxConsumers(queue: Queue): void {
  queue.subscribe<RefreshExecuteMessage["payload"]>(
    COMMANDS.sandboxRefreshExecute,
    async (msg) => handleSandboxRefreshExecute(msg as unknown as RefreshExecuteMessage),
  );
}
