/**
 * inspection-service: Licence module — command publishing helpers.
 *
 * _Requirements: SVC-108_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

export interface LicenceCreatePayload {
  entityId: string;
  licenceType: string;
  licenceNumber: string;
  validFrom: string;
  validTo: string;
  conditions?: unknown[] | undefined;
  renewalFee?: string | undefined;
  currency?: string | undefined;
}

export interface LicenceUpdatePayload {
  licenceId: string;
  version: number;
  licenceType?: string | undefined;
  licenceNumber?: string | undefined;
  validFrom?: string | undefined;
  validTo?: string | undefined;
  conditions?: unknown[] | undefined;
  renewalFee?: string | undefined;
}

export interface LicenceRenewPayload {
  licenceId: string;
}

export interface LicenceSuspendPayload {
  licenceId: string;
}

export interface LicenceRevokePayload {
  licenceId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function envelope(
  ctx: RequestContext,
  type: string,
  payload: Record<string, unknown>,
) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  };
}

// ── Publish functions ─────────────────────────────────────────────────────────

export async function publishLicenceCreate(
  payload: LicenceCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.licenceCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.licenceCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishLicenceUpdate(
  payload: LicenceUpdatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.licenceUpdate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.licenceUpdate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishLicenceRenew(
  payload: LicenceRenewPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.licenceRenew, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.licenceRenew, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishLicenceSuspend(
  payload: LicenceSuspendPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.licenceSuspend, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.licenceSuspend, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishLicenceRevoke(
  payload: LicenceRevokePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.licenceRevoke, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.licenceRevoke, msg);
  return { accepted: true, messageId: msg.messageId };
}
