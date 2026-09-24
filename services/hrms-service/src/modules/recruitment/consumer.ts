import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as templateRepo from "./jd-template-repo.js";
import * as employeeRepo from "../employee/repo.js";

const AUDIT = "audit.event.record";
const log = pino({ name: "recruitment-consumer" });

export function registerRecruitmentConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.jobCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; refNo: string; title: string; departmentId: string; designationId?: string;
      vacancies: number; description?: string; vacancyType?: string; location?: string; qualification?: string;
      payRange?: string; isPublished?: boolean; postedAt?: string; closesAt?: string;
      // MEDIUM finding: these three were silently dropped here even when a
      // caller (jd-template-routes.ts's POST .../use, or this route once
      // validators.ts gained templateId) sent them -- neither this payload
      // type nor the insertJobOpening call below read them at all.
      templateId?: string; selectionProcess?: string; requiredDocuments?: string[]; eligibility?: Record<string, unknown>;
    };
    const didInsert = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
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
        templateId: p.templateId ?? null,
        selectionProcess: p.selectionProcess ?? null,
        ...(p.requiredDocuments !== undefined ? { requiredDocuments: p.requiredDocuments } : {}),
        ...(p.eligibility !== undefined ? { eligibility: p.eligibility } : {}),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "job_opening", p.id);
      return true;
    });
    // MEDIUM finding: useCount/traceability. Centralized here (not in the
    // route) so it fires exactly once regardless of which create path set
    // templateId -- the direct route (validators.ts's new templateId field)
    // or jd-template-routes.ts's POST .../use, which used to increment this
    // itself right after publishing and has had that call removed to avoid
    // double-counting now that this handles it for both paths uniformly.
    // Gated on didInsert (not just "outside the transaction"): a redelivered
    // message for an ALREADY-processed job opening must not increment a
    // second time -- markProcessed's guard above already protects the
    // insert itself, this mirrors that same guard for the side effect.
    // Awaited, not fire-and-forget (the /use route's original version of
    // this call was `void`-style): a fire-and-forget call here resolves the
    // whole subscribed handler BEFORE the increment's own write lands, so
    // the queue's drain() -- which this suite's tests rely on to mean "every
    // effect of this message has landed" -- returns too early to observe it.
    // Confirmed live: with `void` here, this regression test's useCount
    // assertion saw 0 every time, not intermittently.
    if (didInsert && p.templateId) await templateRepo.incrementUseCount(p.tenantId, p.templateId);
  });

  queue.subscribe(COMMANDS.applicationCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; jobOpeningId: string; applicantName: string; email?: string; mobile?: string; resumeRef?: string; qualification?: string; experienceYears?: number; skills?: string[]; source?: string; institutionName?: string; graduationYear?: number; semester?: string; tradeCategory?: string; itiCertNo?: string; availabilityHoursPerWeek?: number; stipendExpectedMinor?: number; dedupKey?: string | null };
    try {
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
          // Bug 2 hardening: dedupKey is derived by the route (routes.ts's
          // deriveDedupKey, threaded through commands.ts) -- null when the
          // vacancy allows multiple applications or there's no email to key
          // on. The DB's existing partial unique index
          // (hrms_applications_dedup_uq) is what actually enforces it; see
          // the catch block below for the resulting 23505.
          dedupKey: p.dedupKey ?? null,
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
    } catch (err: unknown) {
      // Bug 2 hardening: with dedupKey now set, a genuine duplicate trips
      // hrms_applications_dedup_uq as a hard 23505 here instead of silently
      // inserting a second row. A duplicate can never succeed on retry, so
      // log and stop rather than let it become a poison message.
      if (err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "23505") {
        log.warn({ applicationId: p.id, tenantId: p.tenantId, jobOpeningId: p.jobOpeningId }, "duplicate application suppressed by dedup_key unique index");
        return;
      }
      throw err;
    }
  });

  queue.subscribe(COMMANDS.applicationOffer, async (msg) => {
    const p = msg.payload as { offerId: string; applicationId: string; tenantId: string; ctcMinor: number; currency: string; joiningDate?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Bug 1 hardening: atomically claim the application for the offer step
      // (replaces the old blind updateApplication call, which had no stage/
      // status precondition at all -- it would happily move a withdrawn,
      // rejected, or already-hired application to "offered"). Only succeeds
      // when the application is genuinely offer-eligible right now; see
      // repo.claimApplicationForOffer for the exact guard and why routes.ts's
      // synchronous pre-check alone isn't sufficient.
      const claimed = await repo.claimApplicationForOffer(tx, p.applicationId, p.tenantId);
      if (!claimed) {
        log.warn({ applicationId: p.applicationId, tenantId: p.tenantId }, "offer rejected: application is not in an offerable state");
        return;
      }

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
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // BUG-3 fix: atomically claim the application for hiring BEFORE
        // creating the employee record (replaces the old blind
        // updateApplication call below). 0 rows affected means this
        // application is already in the "hired" stage -- a duplicate or
        // redelivered hire command that reached this consumer under a
        // different messageId than the original attempt (so markProcessed
        // above didn't catch it -- see commands.ts's hireApplication for the
        // deterministic-messageId half of this fix) -- so skip employee
        // creation entirely rather than creating a second one for the same
        // application.
        const claimed = await repo.claimApplicationForHire(tx, p.applicationId, p.tenantId);
        if (!claimed) {
          log.warn({ applicationId: p.applicationId, tenantId: p.tenantId, employeeId: p.employeeId }, "duplicate hire suppressed: application already hired");
          return;
        }

        // Fetch application for applicant details (already claimed above).
        const application = await repo.findApplicationByIdTx(tx, p.applicationId, p.tenantId);
        const fullName = application?.applicantName ?? "Unknown";
        const email = application?.email ?? null;
        const mobile = application?.mobile ?? null;

        // Recruitment hardening (Bug 3): atomically claim one vacancy on this
        // application's job opening BEFORE creating the employee. Throws
        // (not a bare return) so the WHOLE transaction rolls back --
        // including the claimApplicationForHire claim above -- leaving the
        // application back in its pre-hire ("offered") state for HR to
        // reassign, rather than stuck falsely "hired" with no employee
        // created and no vacancy consumed. See repo.claimVacancy for the
        // atomic UPDATE...WHERE guard against two concurrent hires racing
        // for the same last vacancy.
        if (application?.jobOpeningId) {
          const vacancyClaimed = await repo.claimVacancy(tx, application.jobOpeningId, p.tenantId);
          if (!vacancyClaimed) throw new Error("NO_VACANCY_AVAILABLE");
        }

        // Recruitment hardening (minor item): fail fast with a clear error
        // instead of a raw FK-violation crash if the caller passed a
        // department/designation that doesn't exist for this tenant.
        const [deptOk, desigOk] = await Promise.all([
          employeeRepo.departmentExistsTx(tx, p.departmentId, p.tenantId),
          employeeRepo.designationExistsTx(tx, p.designationId, p.tenantId),
        ]);
        if (!deptOk) throw new Error(`DEPARTMENT_NOT_FOUND: ${p.departmentId}`);
        if (!desigOk) throw new Error(`DESIGNATION_NOT_FOUND: ${p.designationId}`);

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
    } catch (err: unknown) {
      // Bug 3 / FK hardening: none of these can ever succeed on a retry (the
      // vacancy stays exhausted, the bad FK stays bad), so log and stop
      // rather than let it become a poison message that retries forever.
      const reason = err instanceof Error ? err.message : "";
      if (reason === "NO_VACANCY_AVAILABLE" || reason.startsWith("DEPARTMENT_NOT_FOUND") || reason.startsWith("DESIGNATION_NOT_FOUND")) {
        log.warn({ applicationId: p.applicationId, tenantId: p.tenantId, employeeId: p.employeeId, reason }, "hire rejected");
        return;
      }
      throw err;
    }

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
