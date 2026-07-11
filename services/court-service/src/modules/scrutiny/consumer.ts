import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { caseDefect, caseScrutiny } from "./schema.js";
import * as repo from "./repo.js";
import { assertDefectTransition, assertScrutinyTransition, type DefectStatus, type ScrutinyStatus } from "./domain.js";

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

type ResolveScrutinyPayload = {
  scrutinyId: string;
  tenantId: string;
  status: ScrutinyStatus;
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
      // A scrutiny always STARTS pending — the outcome (cleared/defective) is set
      // later via the guarded resolveScrutiny transition, never trusted from the
      // creation payload.
      const status = "pending";
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

  // Resolve a scrutiny (§13) — version-guarded, state-machine-checked. A pending
  // scrutiny is cleared or marked defective; a defective one is later cleared.
  register<ResolveScrutinyPayload>(COMMANDS.resolveScrutiny, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const current = await repo.getScrutinyForUpdate(tx, p.tenantId, p.scrutinyId);
      if (!current) throw new NonRetryableError(`SCRUTINY_NOT_FOUND: ${p.scrutinyId}`);
      if (current.status === p.status) return; // already in target state; no-op

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: scrutiny ${p.scrutinyId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }
      try {
        assertScrutinyTransition(current.status, p.status);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      await versionedUpdate(tx, caseScrutiny, {
        id: p.scrutinyId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          status: p.status,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "scrutiny",
      });

      await enqueue(tx, {
        topic: EVENTS.scrutinyResolved,
        eventType: EVENTS.scrutinyResolved,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { scrutinyId: p.scrutinyId, status: p.status },
      });
      await audit(tx, msg, "resolve_scrutiny", "court_scrutiny", p.scrutinyId);
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
