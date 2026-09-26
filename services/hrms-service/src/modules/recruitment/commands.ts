import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import type { CreateJobOpeningBody, CreateApplicationBody, OfferApplicationBody, HireApplicationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createJobOpening(ctx: RequestContext, body: CreateJobOpeningBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.jobCreate, {
    messageId: id, type: COMMANDS.jobCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * dedupKey: Bug 2 hardening. Derived by the caller (routes.ts, which has the
 * job opening's advertised eligibility criteria in hand) and threaded
 * through the command payload so the applicationCreate consumer can set it
 * on insert -- see recruitment/repo.ts's NOT_OFFERABLE_* comment block
 * neighbours and eligibility-routes.ts for the original (correct) pattern
 * this mirrors. null means "don't dedupe" (vacancy allows multiple
 * applications, or no email to key on).
 */
export async function createApplication(ctx: RequestContext, body: CreateApplicationBody, dedupKey: string | null): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.applicationCreate, {
    messageId: id, type: COMMANDS.applicationCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, dedupKey },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function offerApplication(ctx: RequestContext, id: string, body: OfferApplicationBody): Promise<Accepted> {
  const offerId = randomUUID();
  await queue.publish(COMMANDS.applicationOffer, {
    messageId: offerId, type: COMMANDS.applicationOffer,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { offerId, applicationId: id, tenantId: ctx.tenantId, ...body },
  });
  return { id: offerId, status: "accepted", correlationId: ctx.correlationId };
}

export async function hireApplication(ctx: RequestContext, applicationId: string, body: HireApplicationBody): Promise<Accepted> {
  // BUG-3 fix (PR #1539): derive a STABLE employeeId/messageId from the
  // applicationId instead of a fresh randomUUID() on every call. An
  // application can only legitimately be hired once, so a retried or
  // double-clicked Hire action for the SAME application must always
  // produce the SAME messageId -- that's what lets the queue's own
  // idempotency guard (packages/outbox's markProcessed, an atomic
  // `INSERT ... ON CONFLICT DO NOTHING RETURNING`, see bus.ts) dedupe it,
  // instead of minting a second, unrelated messageId that sails straight
  // past dedup and lets the consumer insert a second employee row for one
  // application.
  //
  // MEDIUM finding: this used to call the ad hoc uuidV5() helper directly.
  // Recruitment-hire is one of the Recruitment -> HRMS -> Payroll
  // integration-seam publishes, so it's now derived through idempotentId()
  // (@civitasone/auth, tenant-scoped since PR #1565) -- the same mechanism
  // every other cross-service command in this codebase uses (finance's
  // gl/commands.ts reverseJournal, treasury/commands.ts publishDisposition,
  // etc.), rather than a bespoke one-off. Same determinism guarantee as
  // before (the "recruitment.hire:" key namespaces this from any other
  // idempotentId use), now via the shared, tenant-scoped mechanism. If
  // idempotencyKey were ever omitted, idempotentId() falls back to a fresh
  // random UUID per its own documented behaviour -- i.e. duplicates would
  // reappear, which is exactly what a retried hire must NOT do.
  //
  // This closes the common path (retry / redelivery / double-click all now
  // collide on one messageId, caught cheaply before any DB write). The hire
  // consumer additionally guards the employee-creation itself with an atomic
  // application-status claim (recruitment/repo.ts's claimApplicationForHire)
  // for the same reason leave/repo.ts guards approveLeaveApp with a
  // WHERE-status UPDATE: defense in depth against two hire attempts that,
  // for whatever reason, still reach the consumer under different messageIds.
  // Prefers a genuine client-supplied key (ctx.idempotencyKey, populated by
  // resolveServiceContext from the x-idempotency-key header -- see
  // @civitasone/auth/context) when the caller sent one; falls back to this
  // deterministic domain key otherwise so the guarantee holds unconditionally.
  const employeeId = idempotentId({ idempotencyKey: ctx.idempotencyKey ?? `recruitment.hire:${applicationId}`, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.applicationHire, {
    messageId: employeeId, type: COMMANDS.applicationHire,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { employeeId, applicationId, tenantId: ctx.tenantId, ...body },
  });
  return { id: employeeId, status: "accepted", correlationId: ctx.correlationId };
}

import type { PublicApplicationBody } from "./validators.js";

const PUBLIC_ACTOR = "00000000-0000-0000-0000-000000000000";

export type PublicApplicationResult = { id: string; applicationNo: string; status: string; alreadyApplied: boolean };

/**
 * HIGH fix (response-integrity): public applications used to be created by
 * generating an id here and firing COMMANDS.applicationCreate at the queue
 * (the old createPublicApplication, replaced by this function), returning
 * 202 + that id immediately — BEFORE consumer.ts's applicationCreate
 * subscriber (the thing that actually runs the INSERT) had even run. Proven
 * exploitable: 5 genuinely concurrent (Promise.all) identical-email
 * submissions against the same opening each got back their own 202 + id,
 * but hrms_applications_dedup_uq (migration 0074_application_eligibility.sql)
 * only ever lets ONE row land — the other 4 ids callers were shown correspond
 * to NO row at all. The consumer's catch of the resulting 23505 just logs
 * "duplicate application suppressed" and drops the message; there was no way
 * for those callers, who already hold an apparently-successful response, to
 * ever find out.
 *
 * Fix: do the insert here, synchronously, inside the request. This table's
 * write is one cheap insert (+ a notification enqueue + an audit enqueue,
 * both via the transactional outbox, so still just DB writes in the same
 * transaction) — nothing about it actually needed the queue's async
 * fan-out. The DB's own partial unique index — not app-level timing — now
 * decides who wins a concurrent race, and every caller (winner or not) is
 * told the outcome the index actually produced before the response is sent:
 * `alreadyApplied: true` carries back the REAL, already-persisted row's own
 * id/applicationNo (routes.ts turns this into a 409 with that id attached)
 * instead of a fabricated one. The (unauthenticated, no RequestContext)
 * public route still can't use publishF3Write, same reasoning as
 * candidate-public-auth-routes.ts's scopedWriteForTenant — hence the
 * literal SYSTEM actor UUID, as before.
 */
export async function submitPublicApplication(tenantId: string, body: PublicApplicationBody, dedupKey: string | null): Promise<PublicApplicationResult> {
  const id = randomUUID();
  const applicationNo = `APP-${new Date().getFullYear()}-${id.slice(-6).toUpperCase()}`;
  try {
    await db.transaction(async (tx) => {
      await repo.insertApplication(tx, {
        id, tenantId, jobOpeningId: body.jobOpeningId,
        applicantName: body.applicantName, email: body.email,
        mobile: body.mobile ?? null, resumeRef: null,
        qualification: body.qualification ?? null,
        experienceYears: body.experienceYears ?? null,
        skills: body.skills ?? [],
        source: "public_portal",
        applicationNo, stage: "applied", status: "active",
        dedupKey,
        institutionName: body.institutionName ?? null,
        graduationYear: body.graduationYear ?? null,
        semester: body.semester ?? null,
        tradeCategory: body.tradeCategory ?? null,
        itiCertNo: body.itiCertNo ?? null,
        availabilityHoursPerWeek: body.availabilityHoursPerWeek ?? null,
        stipendExpectedMinor: body.stipendExpectedMinor != null ? BigInt(body.stipendExpectedMinor) : null,
        createdBy: PUBLIC_ACTOR, updatedBy: PUBLIC_ACTOR,
      });
      if (body.email) {
        await enqueue(tx, {
          topic: "hrms.candidate.application_confirmed", eventType: "hrms.candidate.application_confirmed",
          tenantId, actorId: PUBLIC_ACTOR, correlationId: id,
          payload: { applicationId: id, applicationNo, applicantName: body.applicantName, email: body.email, jobOpeningId: body.jobOpeningId },
        });
      }
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId, actorId: PUBLIC_ACTOR, correlationId: id,
        payload: { service: "hrms", action: "create", resourceType: "application", resourceId: id, outcome: "success" },
      });
    });
    return { id, applicationNo, status: "received", alreadyApplied: false };
  } catch (err: unknown) {
    // Mirrors consumer.ts's applicationCreate catch: a 23505 here can only be
    // hrms_applications_dedup_uq (the partial index only applies WHEN
    // dedupKey is set), i.e. a genuine concurrent/duplicate submission that
    // lost the race. Look up whichever row actually won so the caller gets
    // told about THAT one instead of nothing.
    if (dedupKey && err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "23505") {
      const existing = await repo.findApplicationByDedupKey(tenantId, body.jobOpeningId, dedupKey);
      if (existing) {
        return { id: existing.id, applicationNo: existing.applicationNo ?? "", status: "duplicate", alreadyApplied: true };
      }
    }
    throw err;
  }
}
