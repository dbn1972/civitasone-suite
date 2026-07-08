import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

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

      await repo.insertClaim(tx, {
        id: p.id,
        tenantId: p.tenantId,
        employeeId: p.employeeId,
        claimType: p.claimType,
        amountMinor: BigInt(p.amountMinor),
        hospitalName: p.hospitalName,
        ...(p.hospitalId ? { hospitalId: p.hospitalId } : {}),
        diagnosis: p.diagnosis,
        documents: p.documents,
        ...(p.dependantName ? { dependantName: p.dependantName } : {}),
        ...(p.dependantRelation ? { dependantRelation: p.dependantRelation } : {}),
        ...(p.remarks ? { remarks: p.remarks } : {}),
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

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

      await repo.updateClaimStatus(tx, p.claimId, {
        status: p.status,
        ...(p.status === "approved" && p.approvedAmountMinor != null
          ? { approvedAmountMinor: BigInt(p.approvedAmountMinor) }
          : {}),
        approvedBy: msg.actorId,
        approvedAt: new Date(),
        ...(p.status === "rejected" && p.remarks
          ? { rejectionReason: p.remarks }
          : {}),
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: p.status === "approved" ? "approve" : "reject",
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
