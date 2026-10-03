/**
 * Consumer for the fin-recruitment-01 write ops (all arrive on COMMANDS.f3RouteWrite; each
 * consumer in the hrms worker claims only its own `op` names):
 *
 *   recruitment_settings_routes__0  upsert the per-tenant recruitment settings (+ audit)
 *   recruitment_pii_reveal__0       audit event for an applicant-contact / resume reveal
 *
 * Every handler runs inside ONE transaction that also records the message as processed
 * (idempotent redelivery) and enqueues the `audit.event.record` outbox event, so the write
 * and its audit trail commit or roll back together.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { emitAudit } from "./audit-emit.js";
import * as settingsRepo from "./settings-repo.js";

const log = pino({ name: "hrms-recruitment-finish" });

export const FINISH_OPS = ["recruitment_settings_routes__0", "recruitment_pii_reveal__0"] as const;

export function registerRecruitmentFinishConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    if (!(FINISH_OPS as readonly string[]).includes(op)) return;
    const body = (p.body ?? {}) as Record<string, any>;
    const params = (p.params ?? {}) as Record<string, any>;
    const tenantId = String(p.tenantId);
    const auditCtx = { tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "recruitment_settings_routes__0": {
            const patch: Partial<settingsRepo.RecruitmentSettings> = {};
            for (const k of ["organisationName", "departmentName", "emblemUrl", "offerWorkflowRequired", "applicantPurposeNote"] as const) {
              if (k in body) (patch as Record<string, unknown>)[k] = body[k];
            }
            const before = await settingsRepo.getSettingsTx(tx, tenantId);
            const after = await settingsRepo.upsertSettings(tx, tenantId, msg.actorId, patch);
            await emitAudit(tx, auditCtx, "recruitment_settings_updated", "recruitment_settings", tenantId, {
              changed: Object.keys(patch),
              offerWorkflowRequiredBefore: before.offerWorkflowRequired,
              offerWorkflowRequiredAfter: after.offerWorkflowRequired,
            });
            break;
          }
          case "recruitment_pii_reveal__0": {
            // NEVER put the revealed values in the audit payload -- only that, by whom, why and which fields.
            await emitAudit(tx, auditCtx, String(body.action ?? "applicant_contact_revealed"), body.scope === "candidate_profile" ? "candidate" : "application", String(params.id ?? p.id), {
              scope: body.scope, reason: body.reason, fields: body.fields,
            });
            break;
          }
        }
      });
    } catch (err) {
      if (op === "recruitment_pii_reveal__0") {
        // The values were already returned to the caller (the command was durably queued first), so a failure here
        // means a reveal without its audit row yet. Retries follow; if it dead-letters, the queue's dlq_total{topic}
        // counts it. Make it unmistakable for alerting.
        log.error({ err, op, messageId: msg.messageId, tenantId, actorId: msg.actorId, applicationId: params.id, alert: "pii_reveal_audit_failed" },
          "PII reveal audit write failed -- the reveal was served but is NOT yet on the audit trail; investigate / replay");
      } else {
        log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      }
      throw err;
    }
  });
}
