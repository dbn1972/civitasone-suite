import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
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
  const employeeId = randomUUID();
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
  await queue.publish(COMMANDS.applicationCreate, {
    messageId: id, type: COMMANDS.applicationCreate,
    tenantId, actorId: "public", correlationId: id, schemaVersion: "1.0",
    payload: {
      id, tenantId, jobOpeningId: body.jobOpeningId,
      applicantName: body.applicantName, email: body.email,
      mobile: body.mobile ?? null,
      qualification: body.qualification ?? null,
      experienceYears: body.experienceYears ?? null,
      skills: body.skills ?? [],
      source: "public_portal",
    },
  });
  return { id, status: "received" };
}
