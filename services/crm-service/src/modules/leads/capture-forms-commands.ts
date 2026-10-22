/**
 * Command publishers for the LM-002 public lead-capture form registry.
 *
 * Mirrors field-rules-commands.ts: derive a scoped commandId, publish, invalidate the
 * read cache, hand the route back an Accepted envelope. The cache is invalidated HERE
 * as well as in the consumer because the route answers 202 immediately — a client that
 * re-reads the list before the consumer has run must not be served a snapshot taken
 * before its own change was queued.
 */
import { createHmac } from "node:crypto";
import { idempotentId } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateCaptureFormBody,
  UpdateCaptureFormBody,
} from "./capture-forms-validators.js";
import * as repo from "./capture-forms-repo.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** Same constant the read path builds its cache key from, so the invalidation below
 *  cannot drift from the key listForms writes. */
const RESOURCE = repo.RESOURCE;

/** Platform default when an admin does not choose a per-minute budget. */
const DEFAULT_MAX_PER_MINUTE = 10;

export async function createCaptureForm(
  ctx: RequestContext,
  body: CreateCaptureFormBody,
): Promise<Accepted & { formKey: string }> {
  const id = commandId(ctx, `${COMMANDS.createLeadCaptureForm}:${body.name}`);
  /**
   * The key is generated HERE, on the server, and returned to the admin once so they can
   * embed it. A client-chosen key would be guessable — and the key is the only thing an
   * anonymous caller presents on the public endpoint, so a guessable key means anyone
   * can post leads into any tenant. It is also NOT carried on the emitted event (see
   * EVENTS.leadCaptureFormCreated) — only on the command, whose sole consumer writes it.
   */
  const formKey = repo.generateFormKey();

  await queue.publish(COMMANDS.createLeadCaptureForm, {
    messageId: id,
    type: COMMANDS.createLeadCaptureForm,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      formKey,
      name: body.name,
      enabled: body.enabled ?? true,
      // Defaults to true, matching the column default: a form created without a view on
      // consent must be the safe one (DPDP Act 2023).
      requireConsent: body.requireConsent ?? true,
      allowedOrigins: body.allowedOrigins ?? [],
      ...(body.defaultLeadSource !== undefined
        ? { defaultLeadSource: body.defaultLeadSource }
        : {}),
      ...(body.campaignId !== undefined ? { campaignId: body.campaignId } : {}),
      maxPerMinute: body.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId, formKey };
}

export async function updateCaptureForm(
  ctx: RequestContext,
  id: string,
  body: UpdateCaptureFormBody,
): Promise<Accepted> {
  // Scoped per form id so one reused client idempotency key cannot collapse edits to
  // two different forms into a single command.
  const messageId = commandId(ctx, `${COMMANDS.updateLeadCaptureForm}:${id}`);
  await queue.publish(COMMANDS.updateLeadCaptureForm, {
    messageId,
    type: COMMANDS.updateLeadCaptureForm,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      // Only the fields the admin actually sent. Conditional spreads rather than
      // `?? null`, so an omitted field stays untouched instead of being blanked —
      // `exactOptionalPropertyTypes` makes that distinction load-bearing.
      changed: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.requireConsent !== undefined ? { requireConsent: body.requireConsent } : {}),
        ...(body.allowedOrigins !== undefined ? { allowedOrigins: body.allowedOrigins } : {}),
        ...(body.defaultLeadSource !== undefined
          ? { defaultLeadSource: body.defaultLeadSource }
          : {}),
        ...(body.campaignId !== undefined ? { campaignId: body.campaignId } : {}),
        ...(body.maxPerMinute !== undefined ? { maxPerMinute: body.maxPerMinute } : {}),
      },
      updatedBy: ctx.actorId,
    },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * The key a rotate request returns MUST be the key the consumer stores. The messageId
 * comes from the client Idempotency-Key, so a retry reuses it and the consumer's
 * markProcessed drops the second command; a fresh random key minted per request would
 * then be shown to the admin without ever being stored. So when a client key is present
 * the form key is derived deterministically from the messageId (HMAC with the service's
 * CRM_PII_KEY, so it is not computable from the client-held Idempotency-Key alone) and a
 * retry returns the same key that the first command stored. With no client key, or no
 * server secret to derive from, the key is random and the messageId is fresh too, so
 * every command that is published carries exactly the key that is returned.
 */
function rotationIdentity(ctx: RequestContext, id: string): { messageId: string; formKey: string } {
  const scope = `${COMMANDS.rotateLeadCaptureFormKey}:${id}`;
  const secret = process.env.CRM_PII_KEY;
  if (ctx.idempotencyKey && secret && secret.length >= 16) {
    const messageId = commandId(ctx, scope);
    const formKey = createHmac("sha256", secret)
      .update(`lead-capture-form-key:${ctx.tenantId}:${messageId}`)
      .digest("hex");
    return { messageId, formKey };
  }
  return { messageId: idempotentId({}), formKey: repo.generateFormKey() };
}

/**
 * GAP-CRM-LEAD-FORMS-01: rotate a form's public key in place. The new key is minted
 * HERE (server-side) and returned once so the admin can re-embed the form; it rides the
 * command envelope only, never an emitted event. A retry that reuses the client
 * idempotency key collapses to one applied command AND returns the same key (see
 * rotationIdentity).
 */
export async function rotateCaptureFormKey(
  ctx: RequestContext,
  id: string,
): Promise<Accepted & { formKey: string }> {
  const { messageId, formKey } = rotationIdentity(ctx, id);
  await queue.publish(COMMANDS.rotateLeadCaptureFormKey, {
    messageId,
    type: COMMANDS.rotateLeadCaptureFormKey,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, formKey, updatedBy: ctx.actorId },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId, formKey };
}

export async function deleteCaptureForm(ctx: RequestContext, id: string): Promise<Accepted> {
  const messageId = commandId(ctx, `${COMMANDS.deleteLeadCaptureForm}:${id}`);
  await queue.publish(COMMANDS.deleteLeadCaptureForm, {
    messageId,
    type: COMMANDS.deleteLeadCaptureForm,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
