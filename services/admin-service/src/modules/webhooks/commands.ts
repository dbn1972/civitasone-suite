/**
 * Webhook command handlers (WRITE PATH).
 * Route → validate → publish command → return 202.
 */
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface WebhookCreatePayload {
  url: string;
  events: string[];
  description?: string;
}

export interface WebhookUpdatePayload {
  url?: string;
  events?: string[];
  active?: boolean;
  description?: string;
}

const CMD_CREATE = "admin.webhook.create";
const CMD_UPDATE = "admin.webhook.update";
const CMD_DELETE = "admin.webhook.delete";
const CMD_TEST = "admin.webhook.test";
const CMD_REPLAY = "admin.webhook.replay";
const CMD_ROTATE_REQUEST = "admin.webhook.rotate.request";
const CMD_ROTATE_DECIDE = "admin.webhook.rotate.decide";

/**
 * Generate a cryptographically secure webhook secret.
 */
export function generateSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/**
 * Sign a payload with HMAC-SHA256.
 * Header format: sha256=<hex-digest>
 */
export function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Verify HMAC-SHA256 signature.
 */
export function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = signPayload(secret, body);
  if (expected.length !== signature.length) return false;
  // Constant-time comparison
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function webhookCreate(ctx: RequestContext, payload: WebhookCreatePayload): Promise<Accepted & { secret: string }> {
  const id = randomUUID();
  const secret = generateSecret();
  await queue.publish(CMD_CREATE, {
    messageId: id,
    type: CMD_CREATE,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, url: payload.url, events: payload.events, secret, description: payload.description ?? "" },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId, secret };
}

export async function webhookUpdate(ctx: RequestContext, webhookId: string, payload: WebhookUpdatePayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(CMD_UPDATE, {
    messageId: id,
    type: CMD_UPDATE,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { webhookId, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function webhookDelete(ctx: RequestContext, webhookId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(CMD_DELETE, {
    messageId: id,
    type: CMD_DELETE,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { webhookId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function webhookTest(ctx: RequestContext, webhookId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(CMD_TEST, {
    messageId: id,
    type: CMD_TEST,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { webhookId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * CAP-054 replay: re-deliver a past delivery. A NEW delivery row is created
 * (replay_of = original) so the dedup index does not block it.
 */
export async function webhookReplay(ctx: RequestContext, webhookId: string, deliveryId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(CMD_REPLAY, {
    messageId: id,
    type: CMD_REPLAY,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, webhookId, deliveryId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * CAP-054 secret rotation — MAKER step. Generates a fresh secret held pending
 * until a different admin approves it (maker-checker).
 */
export async function webhookRotateRequest(
  ctx: RequestContext,
  webhookId: string,
  reason?: string,
): Promise<Accepted & { rotationId: string }> {
  const rotationId = randomUUID();
  const newSecret = generateSecret();
  await queue.publish(CMD_ROTATE_REQUEST, {
    messageId: rotationId,
    type: CMD_ROTATE_REQUEST,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { rotationId, webhookId, tenantId: ctx.tenantId, newSecret, reason: reason ?? null },
  });
  return { id: rotationId, rotationId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * CAP-054 secret rotation — CHECKER step. Approve or reject a pending rotation.
 * The consumer enforces requester != decider.
 */
export async function webhookRotateDecide(
  ctx: RequestContext,
  rotationId: string,
  decision: "approve" | "reject",
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(CMD_ROTATE_DECIDE, {
    messageId: id,
    type: CMD_ROTATE_DECIDE,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { rotationId, tenantId: ctx.tenantId, decision, deciderId: ctx.actorId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
