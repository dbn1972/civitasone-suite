import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "medical-consumer" });
const AUDIT = "audit.event.record";

export function registerMedicalConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.medicalClaimCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      claimType: string;
      amountMinor: number;
      hospitalName: string;
      hospitalId?: string;
      diagnosis: string;
      documents: string[];
      dependantName?: string;
      dependantRelation?: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Insert medical claim with status 'pending'
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "create",
          resourceType: "medical_claim",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "medical_claims", p.employeeId));
    log.info({ messageId: msg.messageId }, "medical claim created processed");
  });

  queue.subscribe(COMMANDS.medicalClaimApprove, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      claimId: string;
      status: "approved" | "rejected";
      approvedAmountMinor?: number;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Update medical claim status, set approved amount if approved
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "approve",
          resourceType: "medical_claim",
          resourceId: p.claimId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "medical_claim", p.claimId));
    log.info({ messageId: msg.messageId }, "medical claim approval processed");
  });

  log.info("medical consumers registered");
}
