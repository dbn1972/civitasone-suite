import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { normalizeCertType } from "./domain.js";
import * as repo from "./repo.js";
import type { RequestIssuanceBody, AmendBody, RenewBody, RevokeBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(
  ctx: RequestContext, type: string, id: string, payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(type, {
    messageId: randomUUID(),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function requestIssuance(ctx: RequestContext, body: RequestIssuanceBody): Promise<Accepted> {
  const id = randomUUID();
  const certType = normalizeCertType(body.certType);
  return publish(ctx, COMMANDS.issuanceRequest, id, { id, ...body, certType });
}

export async function approveIssuance(ctx: RequestContext, id: string): Promise<Accepted> {
  const cert = await repo.findCertById(id, ctx.tenantId);
  if (!cert) throw new HttpError(404, "NOT_FOUND", "certificate not found");
  if (cert.status !== "requested") throw new HttpError(409, "INVALID_STATE", "only a requested certificate can be approved");
  if (cert.requestedBy === ctx.actorId) {
    throw new HttpError(403, "MAKER_CHECKER", "issuance approver must differ from the requester");
  }
  const accepted = await publish(ctx, COMMANDS.issuanceApprove, id, { id });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "certificate", id));
  return accepted;
}

export async function amendCertificate(ctx: RequestContext, id: string, body: AmendBody): Promise<Accepted> {
  const cert = await repo.findCertById(id, ctx.tenantId);
  if (!cert) throw new HttpError(404, "NOT_FOUND", "certificate not found");
  if (!["active", "amended", "renewed"].includes(cert.status)) {
    throw new HttpError(409, "NOT_ACTIVE", `certificate is ${cert.status}`);
  }
  return publish(ctx, COMMANDS.issuanceAmend, id, { id, ...body });
}

export async function renewCertificate(ctx: RequestContext, id: string, body: RenewBody): Promise<Accepted> {
  const cert = await repo.findCertById(id, ctx.tenantId);
  if (!cert) throw new HttpError(404, "NOT_FOUND", "certificate not found");
  if (!["active", "amended", "renewed"].includes(cert.status)) {
    throw new HttpError(409, "NOT_ACTIVE", `certificate is ${cert.status}`);
  }
  return publish(ctx, COMMANDS.issuanceRenew, id, { id, ...body });
}

export async function revokeCertificate(ctx: RequestContext, id: string, body: RevokeBody): Promise<Accepted> {
  const cert = await repo.findCertById(id, ctx.tenantId);
  if (!cert) throw new HttpError(404, "NOT_FOUND", "certificate not found");
  if (["cancelled", "revoked"].includes(cert.status)) {
    throw new HttpError(409, "ALREADY_TERMINATED", `certificate is ${cert.status}`);
  }
  return publish(ctx, COMMANDS.issuanceRevoke, id, { id, ...body });
}
