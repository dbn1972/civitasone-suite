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
import { clearPendingTx, loadMatrixTx, loadOverrideTx, loadPendingTx, replaceMatrixTx, setOverrideTx, setPendingTx } from "./repo.js";
import { tenantHasModule } from "../../shared/tenant-modules.js";

const AUDIT_TOPIC = "audit.event.record";

export interface SettingsUpdatePayload {
  tenantId: string;
  modeOverride?: ApprovalMode | null;
  matrix?: Array<{ upToMinor: string | null; approverRoles: string[] }>;
  /** Stamped by the route: the caller holds super_admin. */
  superAdmin?: boolean;
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
    // Forcing local on a tenant that has Finance: super admin only, and held until a second, different super admin
    // confirms it (the route refuses a non-super-admin with a 403; a command that skips the route is dropped here).
    // Asked outside the transaction: it may call admin-service.
    const gated = p.modeOverride === "local" && (await tenantHasModule(p.tenantId, "finance"));
    if (gated && !p.superAdmin) {
      throw new NonRetryableError("LOCAL_OVERRIDE_REQUIRES_SUPER_ADMIN: switching a tenant that has Finance to local approval needs a super admin");
    }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const beforeMatrix = await loadMatrixTx(tx, p.tenantId);
      const beforeOverride = await loadOverrideTx(tx, p.tenantId);
      const pending = await loadPendingTx(tx, p.tenantId);
      let modeOutcome: "applied" | "requested" | "none" = "none";
      if (bands) await replaceMatrixTx(tx, { tenantId: p.tenantId, actorId: msg.actorId, bands });
      if (p.modeOverride !== undefined) {
        if (gated && !(pending && pending.requestedBy !== msg.actorId)) {
          // First request (or the same person asking again): recorded, not applied.
          await setPendingTx(tx, { tenantId: p.tenantId, actorId: msg.actorId });
          modeOutcome = "requested";
        } else {
          // Any other change, including the confirmation by a second super admin, applies and clears a pending request.
          await setOverrideTx(tx, { tenantId: p.tenantId, actorId: msg.actorId, override: p.modeOverride });
          await clearPendingTx(tx, p.tenantId);
          modeOutcome = "applied";
        }
      }
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "procurement", action: "update", resourceType: "po_approval_settings", resourceId: p.tenantId, outcome: "success",
          details: {
            ...(modeOutcome === "requested" ? { modeChange: "requested", requestedOverride: "local", awaitingSecondSuperAdmin: true } : {}),
            ...(modeOutcome === "applied" && pending && p.modeOverride === "local" ? { modeChange: "confirmed", requestedBy: pending.requestedBy, confirmedBy: msg.actorId } : {}),
            before: { modeOverride: beforeOverride, matrix: beforeMatrix.isDefault ? "default" : wireBands(beforeMatrix.bands) },
            after: {
              modeOverride: p.modeOverride !== undefined && modeOutcome === "applied" ? p.modeOverride : beforeOverride,
              matrix: bands ? wireBands(bands) : (beforeMatrix.isDefault ? "default" : wireBands(beforeMatrix.bands)),
            },
          },
        },
      });
    });
  });
}
