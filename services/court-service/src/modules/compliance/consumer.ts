import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { complianceDirections } from "./schema.js";
import * as repo from "./repo.js";
import { assertTransition, isTerminal, type ComplianceStatus } from "./domain.js";

type CreateDirectionPayload = {
  id: string;
  caseId: string;
  tenantId: string;
  orderId?: string;
  direction: string;
  responsibleAuthority?: string;
  dueDate?: string; // YYYY-MM-DD
};

type UpdateCompliancePayload = {
  directionId: string;
  tenantId: string;
  status: ComplianceStatus;
  progressNotes?: string;
  expectedVersion: number;
};

export function registerComplianceConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Create a compliance direction (§26).
  register<CreateDirectionPayload>(COMMANDS.createDirection, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertDirection(tx, {
        id: p.id,
        tenantId: p.tenantId,
        caseId: p.caseId,
        orderId: p.orderId ?? null,
        direction: p.direction,
        responsibleAuthority: p.responsibleAuthority ?? null,
        dueDate: p.dueDate ?? null,
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.complianceDirected,
        eventType: EVENTS.complianceDirected,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          caseId: p.caseId,
          directionId: p.id,
          orderId: p.orderId ?? null,
          responsibleAuthority: p.responsibleAuthority ?? null,
          dueDate: p.dueDate ?? null,
          status: "pending",
        },
      });
      await audit(tx, msg, "direct", "court_compliance_direction", p.id);
    });
  });

  // Record progress / close a compliance direction (§26) — version-guarded,
  // state-machine-checked.
  register<UpdateCompliancePayload>(COMMANDS.updateCompliance, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const current = await repo.getDirectionForUpdate(tx, p.tenantId, p.directionId);
      if (!current) throw new NonRetryableError(`DIRECTION_NOT_FOUND: ${p.directionId}`);
      if (current.status === p.status) return; // already at target; no-op

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: direction ${p.directionId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }
      try {
        assertTransition(current.status, p.status);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      await versionedUpdate(tx, complianceDirections, {
        id: p.directionId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          status: p.status,
          ...(p.progressNotes !== undefined ? { progressNotes: p.progressNotes } : {}),
          ...(isTerminal(p.status) ? { closedAt: new Date() } : {}),
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "compliance_direction",
      });

      await enqueue(tx, {
        topic: EVENTS.complianceUpdated,
        eventType: EVENTS.complianceUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          directionId: p.directionId,
          status: p.status,
          progressNotes: p.progressNotes ?? null,
          closed: isTerminal(p.status),
        },
      });
      await audit(tx, msg, "update", "court_compliance_direction", p.directionId);
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
