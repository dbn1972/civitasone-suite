import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { uuidV5 } from "../../shared/ids.js";
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

export async function createApplication(ctx: RequestContext, body: CreateApplicationBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.applicationCreate, {
    messageId: id, type: COMMANDS.applicationCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
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
  // BUG-3 fix: derive a STABLE employeeId/messageId from the applicationId
  // instead of a fresh randomUUID() on every call. An application can only
  // legitimately be hired once, so a retried or double-clicked Hire action
  // for the SAME application must always produce the SAME messageId --
  // that's what lets the queue's own idempotency guard (packages/outbox's
  // markProcessed, an atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING`,
  // see bus.ts) dedupe it, instead of minting a second, unrelated messageId
  // that sails straight past dedup and lets the consumer insert a second
  // employee row for one application. uuidV5 is the established pattern for
  // exactly this (see shared/ids.ts's own doc comment); the "recruitment.hire:"
  // prefix namespaces this derivation from any other uuidV5(applicationId, ...)
  // use elsewhere.
  //
  // This closes the common path (retry / redelivery / double-click all now
  // collide on one messageId, caught cheaply before any DB write). The hire
  // consumer additionally guards the employee-creation itself with an atomic
  // application-status claim (recruitment/repo.ts's claimApplicationForHire)
  // for the same reason leave/repo.ts guards approveLeaveApp with a
  // WHERE-status UPDATE: defense in depth against two hire attempts that,
  // for whatever reason, still reach the consumer under different messageIds.
  const employeeId = uuidV5(`recruitment.hire:${applicationId}`);
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
export async function createPublicApplication(tenantId: string, body: PublicApplicationBody): Promise<{ id: string; status: string }> {
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
    },
  });
  return { id, status: "received" };
}
