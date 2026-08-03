import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as disbursementRepo from "../disbursement/repo.js";
import { assertUcExpenditureWithinDisbursed } from "./domain.js";

export function registerUtilisationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.ucSubmit, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; applicationId: string;
      period: string; installmentNo: number; releasedMinor: number; utilisedMinor: number; ucRef?: string;
    };

    const disbursed = await disbursementRepo.sumDisbursedForApplication(db, p.applicationId, p.tenantId);
    const utilisedMinor = BigInt(p.utilisedMinor);

    try {
      assertUcExpenditureWithinDisbursed(disbursed, utilisedMinor);
    } catch (err) {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await enqueue(tx, {
          topic: EVENTS.ucExpenditureExceeds, eventType: EVENTS.ucExpenditureExceeds,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            applicationId: p.applicationId, disbursedMinor: disbursed.toString(),
            utilisedMinor: p.utilisedMinor, reason: String(err),
          },
        });
      });
      return;
    }

    const releasedMinor = BigInt(p.releasedMinor);
    const varianceMinor = releasedMinor - utilisedMinor;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertUcStatement(tx, {
        id: p.id, tenantId: p.tenantId, applicationId: p.applicationId,
        period: p.period, installmentNo: p.installmentNo,
        validationStatus: "pending",
        releasedMinor, utilisedMinor, varianceMinor,
        currency: "INR", status: "submitted", isImmutable: true,
        ucRef: p.ucRef ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.ucSubmitted, eventType: EVENTS.ucSubmitted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { ucId: p.id, applicationId: p.applicationId, installmentNo: p.installmentNo, utilisedMinor: p.utilisedMinor },
      });
      await audit(tx, msg, "submit_uc", "grant_uc_statement", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "uc", p.applicationId));
  });

  queue.subscribe(COMMANDS.complianceReport, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; applicationId: string;
      period: string; kind: string; observation?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertComplianceReport(tx, {
        id: p.id, tenantId: p.tenantId, applicationId: p.applicationId,
        period: p.period, kind: p.kind, observation: p.observation ?? null,
        status: "submitted",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "compliance_report", "grant_compliance_report", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "compliance", p.applicationId));
  });

  queue.subscribe(COMMANDS.ucValidate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; ucId: string;
      status: "validated" | "rejected"; remarks: string | null;
      validatedAt: string; applicationId: string; installmentNo: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertUcValidation(tx, {
        id: p.id,
        tenantId: p.tenantId,
        ucId: p.ucId,
        status: p.status,
        remarks: p.remarks,
        validatedBy: msg.actorId,
        validatedAt: new Date(p.validatedAt),
      });
      await repo.setUcValidationStatus(
        tx, p.ucId, p.tenantId, p.status, msg.actorId, p.remarks,
      );
      const eventType = p.status === "validated" ? EVENTS.ucValidated : EVENTS.ucRejected;
      await enqueue(tx, {
        topic: eventType, eventType,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          ucId: p.ucId, applicationId: p.applicationId,
          installmentNo: p.installmentNo, status: p.status,
        },
      });
      await audit(tx, msg, `uc_${p.status}`, "grant_uc_statement", p.ucId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "uc", p.applicationId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "uc", p.ucId));
  });
}

async function audit(tx: Parameters<typeof markProcessed>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "grant", action, resourceType, resourceId, outcome: "success" },
  });
}
