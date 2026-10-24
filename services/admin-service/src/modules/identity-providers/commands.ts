/**
 * identity-providers command handlers (WRITE PATH): validate -> seal secret -> publish -> 202.
 * The consumer is the only code that writes Postgres. The client secret is sealed here so the
 * plaintext never travels in a queue message; sealing fails closed (503) without a key.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { HttpError } from "../../shared/context.js";
import { SecretKeyUnavailableError, sealSecret } from "../../shared/secret-crypto.js";
import { IDP_COMMANDS } from "./topics.js";
import type { ProviderKind } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

function envelope(ctx: RequestContext, type: string, payload: Record<string, unknown>) {
  const messageId = randomUUID();
  return {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...payload },
  };
}

/** Seal the client secret; returns ciphertext + masked last4. Fail-closed without a key. */
export function sealClientSecret(plain: string): { ciphertext: string; last4: string } {
  try {
    return { ciphertext: sealSecret(plain), last4: plain.slice(-4) };
  } catch (err) {
    if (err instanceof SecretKeyUnavailableError) {
      throw new HttpError(503, "ENCRYPTION_UNAVAILABLE", "the client secret cannot be stored: the secret encryption key is not configured");
    }
    throw err;
  }
}

function splitSecret(body: Record<string, unknown>) {
  const { clientSecret, ...fields } = body;
  const sealed = typeof clientSecret === "string" ? sealClientSecret(clientSecret) : null;
  return {
    fields,
    secret: sealed ? { clientSecretCiphertext: sealed.ciphertext, clientSecretLast4: sealed.last4 } : {},
  };
}

export async function providerCreate(ctx: RequestContext, kind: ProviderKind, body: Record<string, unknown>): Promise<Accepted> {
  const { fields, secret } = splitSecret(body);
  const providerId = randomUUID();
  await queue.publish(IDP_COMMANDS.create, envelope(ctx, IDP_COMMANDS.create, { providerId, kind, ...fields, ...secret }));
  return { id: providerId, status: "accepted", correlationId: ctx.correlationId };
}

export async function providerUpdate(ctx: RequestContext, kind: ProviderKind, providerId: string, body: Record<string, unknown>): Promise<Accepted> {
  const { fields, secret } = splitSecret(body);
  await queue.publish(IDP_COMMANDS.update, envelope(ctx, IDP_COMMANDS.update, { providerId, kind, ...fields, ...secret }));
  return { id: providerId, status: "accepted", correlationId: ctx.correlationId };
}

export async function providerDelete(ctx: RequestContext, kind: ProviderKind, providerId: string): Promise<Accepted> {
  await queue.publish(IDP_COMMANDS.remove, envelope(ctx, IDP_COMMANDS.remove, { providerId, kind }));
  return { id: providerId, status: "accepted", correlationId: ctx.correlationId };
}
