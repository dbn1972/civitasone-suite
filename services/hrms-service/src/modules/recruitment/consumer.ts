import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT = "audit.event.record";

export function registerRecruitmentConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.jobCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; refNo: string; title: string; departmentId: string; designationId?: string; vacancies: number; description?: string; postedAt?: string; closesAt?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertJobOpening(tx, {
        id: p.id, tenantId: p.tenantId, refNo: p.refNo, title: p.title,
        departmentId: p.departmentId, designationId: p.designationId ?? null,
        vacancies: p.vacancies, description: p.description ?? null,
        postedAt: p.postedAt ?? null, closesAt: p.closesAt ?? null, status: "open",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "job_opening", p.id);
    });
  });

  queue.subscribe(COMMANDS.applicationCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; jobOpeningId: string; applicantName: string; email?: string; mobile?: string; resumeRef?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertApplication(tx, {
        id: p.id, tenantId: p.tenantId, jobOpeningId: p.jobOpeningId,
        applicantName: p.applicantName, email: p.email ?? null,
        mobile: p.mobile ?? null, resumeRef: p.resumeRef ?? null,
        stage: "applied", status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "application", p.id);
    });
  });

  queue.subscribe(COMMANDS.applicationOffer, async (msg) => {
    const p = msg.payload as { offerId: string; applicationId: string; tenantId: string; ctcMinor: number; currency: string; joiningDate?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateApplication(tx, p.applicationId, { stage: "offered" });
      await repo.insertOffer(tx, {
        id: p.offerId, tenantId: p.tenantId, applicationId: p.applicationId,
        ctcMinor: BigInt(p.ctcMinor), currency: p.currency as "INR",
        joiningDate: p.joiningDate ?? null, status: "sent",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "offer", "application", p.applicationId);
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType, resourceId, outcome: "success" },
  });
}
