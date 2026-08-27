import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import type { SubmitApplicationBody, ScoreApplicationBody, ApproveApplicationBody, RejectApplicationBody, WithdrawApplicationBody, AssignReviewerBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function submitApplication(ctx: RequestContext, schemeId: string, body: SubmitApplicationBody): Promise<Accepted> {
  const id = randomUUID();
  // grantNo is allocated gaplessly inside the consumer transaction (per-tenant, per-FY counter).
  await queue.publish(COMMANDS.applicationSubmit, {
    messageId: id, type: COMMANDS.applicationSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, schemeId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function scoreApplication(ctx: RequestContext, id: string, body: ScoreApplicationBody): Promise<Accepted> {
  // P0-4 SoD (same pattern as approveApplication): the actor recording a score
  // must be distinct from the applicant who submitted it. `reviewerRef` in the
  // body is a caller-supplied label, not a verified identity, so the only
  // trustworthy check is against the authenticated caller (ctx.actorId).
  const app = await repo.findApplicationById(id, ctx.tenantId);
  if (!app) throw new HttpError(404, "NOT_FOUND", "application not found");
  if (app.submittedBy && app.submittedBy === ctx.actorId) {
    throw new HttpError(403, "SOD_VIOLATION", "scoring must be performed by someone other than the submitter (separation of duties)");
  }
  await queue.publish(COMMANDS.applicationScore, {
    type: COMMANDS.applicationScore,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "application", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveApplication(ctx: RequestContext, id: string, body: ApproveApplicationBody): Promise<Accepted> {
  // P0-4 Separation of Duties: the approver must be distinct from the submitter.
  // Enforced synchronously at the command boundary so the caller gets a 403,
  // and re-asserted in the consumer transaction for defence in depth.
  const app = await repo.findApplicationById(id, ctx.tenantId);
  if (!app) throw new HttpError(404, "NOT_FOUND", "application not found");
  if (app.submittedBy && app.submittedBy === ctx.actorId) {
    throw new HttpError(403, "SOD_VIOLATION", "approver must be different from the submitter (separation of duties)");
  }
  await queue.publish(COMMANDS.applicationApprove, {
    type: COMMANDS.applicationApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, approvedBy: ctx.actorId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "application", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function rejectApplication(ctx: RequestContext, id: string, body: RejectApplicationBody): Promise<Accepted> {
  await queue.publish(COMMANDS.applicationReject, {
    type: COMMANDS.applicationReject,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason: body.reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "application", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function withdrawApplication(ctx: RequestContext, id: string, body: WithdrawApplicationBody): Promise<Accepted> {
  const app = await repo.findApplicationById(id, ctx.tenantId);
  if (!app) throw new HttpError(404, "NOT_FOUND", "application not found");
  const terminal = ["approved", "rejected", "completed", "cancelled"];
  if (terminal.includes(app.status)) {
    throw new HttpError(409, "INVALID_STATE", `cannot withdraw an application in status '${app.status}'`);
  }
  await queue.publish(COMMANDS.applicationWithdraw, {
    type: COMMANDS.applicationWithdraw,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, withdrawnBy: ctx.actorId, reason: body.reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "application", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function assignReviewer(ctx: RequestContext, id: string, body: AssignReviewerBody): Promise<Accepted> {
  const app = await repo.findApplicationById(id, ctx.tenantId);
  if (!app) throw new HttpError(404, "NOT_FOUND", "application not found");
  // P0-4 SoD: whoever assigns the reviewer must not be the applicant.
  if (app.submittedBy && app.submittedBy === ctx.actorId) {
    throw new HttpError(403, "SOD_VIOLATION", "reviewer assignment must be made by someone other than the submitter (separation of duties)");
  }
  if (app.status !== "submitted" && app.status !== "under_review") {
    throw new HttpError(409, "INVALID_STATE", `cannot assign reviewer to application in status '${app.status}'`);
  }
  await queue.publish(COMMANDS.applicationAssignReviewer, {
    type: COMMANDS.applicationAssignReviewer,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, assignedBy: ctx.actorId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "application", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
