import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
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

/**
 * Public application — submitted by an external candidate without authentication.
 * The tenant is resolved from the vacancy, not from the session. Source = "public_portal".
 */
export async function createPublicApplication(tenantId: string, body: PublicApplicationBody, dedupKey: string | null): Promise<{ id: string; status: string }> {
  const id = randomUUID();
  // Public applications use a system actor UUID (the actorId column is uuid type).
  const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
  await queue.publish(COMMANDS.applicationCreate, {
    messageId: id, type: COMMANDS.applicationCreate,
    tenantId, actorId: SYSTEM_ACTOR, correlationId: id, schemaVersion: "1.0",
    payload: {
      id, tenantId, jobOpeningId: body.jobOpeningId,
      applicantName: body.applicantName, email: body.email,
      mobile: body.mobile ?? null,
      qualification: body.qualification ?? null,
      experienceYears: body.experienceYears ?? null,
      skills: body.skills ?? [],
      source: "public_portal",
      // Type-specific fields (only present for internship/apprenticeship/volunteership)
      institutionName: body.institutionName ?? null,
      graduationYear: body.graduationYear ?? null,
      semester: body.semester ?? null,
      tradeCategory: body.tradeCategory ?? null,
      itiCertNo: body.itiCertNo ?? null,
      availabilityHoursPerWeek: body.availabilityHoursPerWeek ?? null,
      stipendExpectedMinor: body.stipendExpectedMinor ?? null,
      // Bug 2 hardening — see createApplication's dedupKey doc comment above.
      dedupKey,
    },
  });
  return { id, status: "received" };
}
