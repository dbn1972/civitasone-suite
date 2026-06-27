import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";

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

  queue.subscribe(COMMANDS.applicationHire, async (msg) => {
    const p = msg.payload as {
      employeeId: string; applicationId: string; tenantId: string;
      employeeNo: string; dateOfJoining: string; basicMinor: number;
      departmentId: string; designationId: string; employeeType: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Fetch application for applicant details
      const application = await repo.findApplicationById(p.applicationId, p.tenantId);
      const fullName = application?.applicantName ?? "Unknown";
      const email = application?.email ?? null;
      const mobile = application?.mobile ?? null;

      // Update application status to hired
      await repo.updateApplication(tx, p.applicationId, { stage: "hired", status: "closed" });

      // Create the employee record
      await employeeRepo.insertEmployee(tx, {
        id: p.employeeId,
        tenantId: p.tenantId,
        employeeNo: p.employeeNo,
        fullName,
        departmentId: p.departmentId,
        designationId: p.designationId,
        dateOfJoining: p.dateOfJoining,
        employeeType: p.employeeType as "permanent",
        basicMinor: BigInt(p.basicMinor),
        currency: "INR",
        status: "probation",
        email,
        mobile,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Emit employeeCreated event (so payroll picks up the new employee)
      await enqueue(tx, {
        topic: EVENTS.employeeCreated, eventType: EVENTS.employeeCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { employeeId: p.employeeId, employeeNo: p.employeeNo, tenantId: p.tenantId },
      });

      await audit(tx, msg, "hire", "application", p.applicationId);
    });

    // Invalidate caches
    await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.applicationId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType, resourceId, outcome: "success" },
  });
}
