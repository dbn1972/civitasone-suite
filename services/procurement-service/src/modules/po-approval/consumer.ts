/**
 * M10: persists a change to the local PO approval settings (mode override and /
 * or threshold matrix), audited with before and after. The approval itself is
 * the existing procurement.po.approve consumer (po/consumer.ts), which re-checks
 * the matrix for a local approval.
 */
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { validateMatrix, wireBands, type MatrixBand } from "./matrix.js";
import { isApprovalMode, type ApprovalMode } from "./mode.js";
import { loadMatrixTx, loadOverrideTx, replaceMatrixTx, setOverrideTx } from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export interface SettingsUpdatePayload {
  tenantId: string;
  modeOverride?: ApprovalMode | null;
  matrix?: Array<{ upToMinor: string | null; approverRoles: string[] }>;
}

export function registerPoApprovalConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.poApprovalSettingsUpdate, async (msg) => {
    const p = msg.payload as SettingsUpdatePayload;
    const bands: MatrixBand[] | undefined = p.matrix?.map((b) => ({ upToMinor: b.upToMinor === null ? null : BigInt(b.upToMinor), approverRoles: b.approverRoles }));
    // The route validated already; a command that still carries an invalid matrix is dead-lettered, never retried.
    if (bands) {
      const problems = validateMatrix(bands);
      if (problems.length > 0) throw new NonRetryableError(`INVALID_MATRIX: ${problems.join("; ")}`);
    }
    if (p.modeOverride !== undefined && p.modeOverride !== null && !isApprovalMode(p.modeOverride)) {
      throw new NonRetryableError(`INVALID_MODE: ${String(p.modeOverride)}`);
    }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const beforeMatrix = await loadMatrixTx(tx, p.tenantId);
      const beforeOverride = await loadOverrideTx(tx, p.tenantId);
      if (bands) await replaceMatrixTx(tx, { tenantId: p.tenantId, actorId: msg.actorId, bands });
      if (p.modeOverride !== undefined) await setOverrideTx(tx, { tenantId: p.tenantId, actorId: msg.actorId, override: p.modeOverride });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "procurement", action: "update", resourceType: "po_approval_settings", resourceId: p.tenantId, outcome: "success",
          details: {
            before: { modeOverride: beforeOverride, matrix: beforeMatrix.isDefault ? "default" : wireBands(beforeMatrix.bands) },
            after: {
              modeOverride: p.modeOverride !== undefined ? p.modeOverride : beforeOverride,
              matrix: bands ? wireBands(bands) : (beforeMatrix.isDefault ? "default" : wireBands(beforeMatrix.bands)),
            },
          },
        },
      });
    });
  });
}
