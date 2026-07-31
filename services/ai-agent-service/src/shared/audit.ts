/**
 * shared/audit.ts — single writer for the AI governance audit trail.
 *
 * DPDP Act 2023 compliance: every entry passes through buildAuditEntry, which
 * truncates and PII-redacts input/output. Callers must never persist or log the
 * raw prompt text — pass it here and the redacted copy is what gets stored and
 * published to the audit sink.
 */
import type { RequestContext } from "@civitasone/types";
import type { ScopedTx } from "./db.js";
import { enqueue } from "./outbox.js";
import { AUDIT_TOPIC, SERVICE } from "../topics.js";
import { buildAuditEntry, type AuditEntry, type AuditEntryInput } from "../modules/governance/domain.js";
import * as auditRepo from "../modules/governance/repo.js";

export async function writeAudit(
  tx: ScopedTx,
  ctx: RequestContext,
  input: AuditEntryInput,
): Promise<AuditEntry> {
  const entry = buildAuditEntry(input);

  await auditRepo.insert(tx, {
    tenantId: ctx.tenantId,
    agentId: entry.agentId,
    action: entry.action,
    input: entry.input,
    output: entry.output,
    blocked: entry.blocked,
    reason: entry.reason,
    createdBy: ctx.actorId,
    updatedBy: ctx.actorId,
  });

  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: {
      service: SERVICE,
      action: entry.action,
      agentId: entry.agentId,
      blocked: entry.blocked,
      reason: entry.reason,
      // redacted copies only
      input: entry.input,
      output: entry.output,
    },
  });

  return entry;
}
