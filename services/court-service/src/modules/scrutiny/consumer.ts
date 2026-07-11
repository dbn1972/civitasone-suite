import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { caseDefect } from "./schema.js";
import * as repo from "./repo.js";
import { assertDefectTransition, type DefectStatus } from "./domain.js";

type RecordScrutinyPayload = {
  id: string;
  caseId: string;
  tenantId: string;
  status?: "pending" | "cleared" | "defective";
  remarks?: string;
};

type RaiseDefectPayload = {
  id: string;
  caseId: string;
  tenantId: string;
  scrutinyId?: string;
  category: string;
  description: string;
  severity?: "minor" | "major" | "critical";
  rectificationDeadline?: string; // YYYY-MM-DD
};

type ResolveDefectPayload = {
  defectId: string;
  tenantId: string;
  resolution: DefectStatus;
  expectedVersion: number;
};

export function registerScrutinyConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Record the registry scrutiny of a case (§13).
  register<RecordScrutinyPayload>(COMMANDS.recordScrutiny, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const status = p.status ?? "pending";
      await repo.insertScrutiny(tx, {
        id: p.id,
        tenantId: p.tenantId,
        caseId: p.caseId,
        status,
        remarks: p.remarks ?? null,
        scrutinizedBy: msg.actorId,
        scrutinizedAt: new Date(),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.scrutinyRecorded,
        eventType: EVENTS.scrutinyRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { caseId: p.caseId, scrutinyId: p.id, status },
      });
      await audit(tx, msg, "record_scrutiny", "court_scrutiny", p.id);
    });
  });

  // Raise a defect against a scrutinized case (§13).
  register<RaiseDefectPayload>(COMMANDS.raiseDefect, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertDefect(tx, {
        id: p.id,
        tenantId: p.tenantId,
        caseId: p.caseId,
        scrutinyId: p.scrutinyId ?? null,
        category: p.category,
        description: p.description,
        severity: p.severity ?? "minor",
        status: "raised",
        rectificationDeadline: p.rectificationDeadline ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.defectRaised,
        eventType: EVENTS.defectRaised,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          caseId: p.caseId,
          defectId: p.id,
          category: p.category,
          severity: p.severity ?? "minor",
          rectificationDeadline: p.rectificationDeadline ?? null,
        },
      });
      await audit(tx, msg, "raise_defect", "court_defect", p.id);
    });
  });

  // Resolve a raised defect (§13) — version-guarded, state-machine-checked.
  register<ResolveDefectPayload>(COMMANDS.resolveDefect, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const current = await repo.getDefectForUpdate(tx, p.tenantId, p.defectId);
      if (!current) throw new NonRetryableError(`DEFECT_NOT_FOUND: ${p.defectId}`);
      if (current.status === p.resolution) return; // already in target state; no-op

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: defect ${p.defectId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }
      try {
        assertDefectTransition(current.status, p.resolution);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      await versionedUpdate(tx, caseDefect, {
        id: p.defectId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          status: p.resolution,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "defect",
      });

      await enqueue(tx, {
        topic: EVENTS.defectResolved,
        eventType: EVENTS.defectResolved,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { defectId: p.defectId, resolution: p.resolution },
      });
      await audit(tx, msg, "resolve_defect", "court_defect", p.defectId);
    });
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
