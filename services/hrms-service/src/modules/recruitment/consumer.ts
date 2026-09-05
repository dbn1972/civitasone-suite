import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as templateRepo from "./jd-template-repo.js";
import * as employeeRepo from "../employee/repo.js";

const AUDIT = "audit.event.record";

export function registerRecruitmentConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.jobCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; refNo: string; title: string; departmentId: string; designationId?: string; vacancies: number; description?: string; vacancyType?: string; location?: string; qualification?: string; payRange?: string; isPublished?: boolean; postedAt?: string; closesAt?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertJobOpening(tx, {
        id: p.id, tenantId: p.tenantId, refNo: p.refNo, title: p.title,
        departmentId: p.departmentId, designationId: p.designationId ?? null,
        vacancies: p.vacancies, description: p.description ?? null,
        vacancyType: p.vacancyType ?? "regular",
        location: p.location ?? null,
        qualification: p.qualification ?? null,
        payRange: p.payRange ?? null,
        isPublished: p.isPublished ?? false,
        postedAt: p.postedAt ?? null, closesAt: p.closesAt ?? null, status: "open",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "job_opening", p.id);
    });
  });

  queue.subscribe(COMMANDS.applicationCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; jobOpeningId: string; applicantName: string; email?: string; mobile?: string; resumeRef?: string; qualification?: string; experienceYears?: number; skills?: string[]; source?: string; institutionName?: string; graduationYear?: number; semester?: string; tradeCategory?: string; itiCertNo?: string; availabilityHoursPerWeek?: number; stipendExpectedMinor?: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Generate a short, human-readable application number.
      const year = new Date().getFullYear();
      const shortId = p.id.slice(-6).toUpperCase();
      const applicationNo = `APP-${year}-${shortId}`;
      await repo.insertApplication(tx, {
        id: p.id, tenantId: p.tenantId, jobOpeningId: p.jobOpeningId,
        applicantName: p.applicantName, email: p.email ?? null,
        mobile: p.mobile ?? null, resumeRef: p.resumeRef ?? null,
        qualification: p.qualification ?? null,
        experienceYears: p.experienceYears ?? null,
        skills: p.skills ?? null,
        source: p.source ?? "internal",
        applicationNo,
        stage: "applied", status: "active",
        institutionName: p.institutionName ?? null,
        graduationYear: p.graduationYear ?? null,
        semester: p.semester ?? null,
        tradeCategory: p.tradeCategory ?? null,
        itiCertNo: p.itiCertNo ?? null,
        availabilityHoursPerWeek: p.availabilityHoursPerWeek ?? null,
        stipendExpectedMinor: p.stipendExpectedMinor != null ? BigInt(p.stipendExpectedMinor) : null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // Enqueue confirmation notification (email seam — picked up by notification service).
      if (p.email && p.source === "public_portal") {
        await enqueue(tx, {
          topic: "hrms.candidate.application_confirmed",
          eventType: "hrms.candidate.application_confirmed",
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            applicationId: p.id,
            applicationNo,
            applicantName: p.applicantName,
            email: p.email,
            jobOpeningId: p.jobOpeningId,
          },
        });
      }
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
      const application = await repo.findApplicationByIdTx(tx, p.applicationId, p.tenantId);
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

      // SVC-003: close the manpower plan -> requisition -> hire loop. The
      // manpower-planning consumer maps jobOpeningId -> requisition -> plan and
      // bumps filled_strength. No-op for openings not born from a plan.
      if (application?.jobOpeningId) {
        await enqueue(tx, {
          topic: EVENTS.positionFilled, eventType: EVENTS.positionFilled,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { jobOpeningId: application.jobOpeningId, employeeId: p.employeeId, tenantId: p.tenantId },
        });
      }

      await audit(tx, msg, "hire", "application", p.applicationId);

      // Notify the newly hired employee and trigger onboarding workflow
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: "hrms.recruitment.hire_confirmed",
          recipient: p.employeeId,
          recipientId: p.employeeId,
          variables: { employeeNo: p.employeeNo, employeeId: p.employeeId },
        }),
      });
      await enqueue(tx, {
        topic: "workflow.instance.create", eventType: "workflow.instance.create",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: randomUUID(),
          tenantId: msg.tenantId,
          name: `Employee Onboarding — ${p.employeeId.slice(0, 8)}`,
          status: "active",
          definitionCode: "employee_onboarding",
          initialTaskName: "Document Submission",
          version: 1,
          refType: "employee",
          refId: p.employeeId,
          triggeredBy: msg.actorId ?? "system",
        },
      });
    });

    // Invalidate caches
    await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.applicationId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
  });

  // JD Template create
  queue.subscribe(COMMANDS.jdTemplateCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; vacancyType?: string; description?: string; qualification?: string; payRange?: string; selectionProcess?: string; requiredDocuments?: string[]; eligibility?: Record<string, unknown>; tags?: string[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await templateRepo.insertTemplate(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name,
        vacancyType: p.vacancyType ?? "regular",
        description: p.description ?? null,
        qualification: p.qualification ?? null,
        payRange: p.payRange ?? null,
        selectionProcess: p.selectionProcess ?? null,
        requiredDocuments: p.requiredDocuments ?? [],
        eligibility: p.eligibility ?? {},
        tags: p.tags ?? null,
        isArchived: false,
        useCount: 0,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "jd_template", p.id);
    });
  });

  // JD Template update
  queue.subscribe(COMMANDS.jdTemplateUpdate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; [k: string]: unknown };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { id, tenantId: _t, ...patch } = p;
      await templateRepo.updateTemplate(tx, id, { ...patch, updatedBy: msg.actorId } as any);
      await audit(tx, msg, "update", "jd_template", id);
    });
  });

  // JD Template archive
  queue.subscribe(COMMANDS.jdTemplateArchive, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await templateRepo.updateTemplate(tx, p.id, { isArchived: true, updatedBy: msg.actorId });
      await audit(tx, msg, "archive", "jd_template", p.id);
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
