/**
 * tenant-settings command handlers (WRITE PATH): validate -> publish -> 202.
 * The consumer is the only code that writes Postgres.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { HttpError } from "../../shared/context.js";
import { ConfigError, configKey, encryptValue } from "../central-config/domain.js";
import { SETTINGS_COMMANDS } from "./topics.js";
import type { SettingsSection } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

function envelope(ctx: RequestContext, type: string, payload: Record<string, unknown>) {
  const id = randomUUID();
  return {
    id,
    msg: {
      // A fresh id per request: a settings change is a repeatable decision, so a deterministic id would drop later edits.
      messageId: id,
      type,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { tenantId: ctx.tenantId, ...payload },
    },
  };
}

/** Seal the SMTP password so the plaintext never travels in a queue message. Fail-closed without a key. */
export function sealSmtpPassword(plain: string): string {
  const key = configKey();
  if (!key) {
    throw new HttpError(503, "ENCRYPTION_UNAVAILABLE", "the SMTP password cannot be stored: CONFIG_ENC_KEY is not configured");
  }
  try {
    return encryptValue({ smtpPass: plain }, key);
  } catch (err) {
    if (err instanceof ConfigError) throw new HttpError(err.status, err.code, err.message);
    throw err;
  }
}

export async function settingsUpdate(
  ctx: RequestContext,
  section: SettingsSection,
  patch: Record<string, unknown>,
): Promise<Accepted> {
  const { smtpPass, ...values } = patch;
  const secretCiphertext = typeof smtpPass === "string" ? sealSmtpPassword(smtpPass) : undefined;
  const { id, msg } = envelope(ctx, SETTINGS_COMMANDS.update, {
    section,
    values,
    ...(secretCiphertext !== undefined ? { secretCiphertext } : {}),
  });
  await queue.publish(SETTINGS_COMMANDS.update, msg);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function emailTest(ctx: RequestContext, recipient: string): Promise<Accepted> {
  const { id, msg } = envelope(ctx, SETTINGS_COMMANDS.emailTest, { recipient });
  await queue.publish(SETTINGS_COMMANDS.emailTest, msg);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function logoSet(ctx: RequestContext, contentType: string, dataBase64: string, sha256: string, sizeBytes: number): Promise<Accepted> {
  const { id, msg } = envelope(ctx, SETTINGS_COMMANDS.logoSet, { contentType, dataBase64, sha256, sizeBytes });
  await queue.publish(SETTINGS_COMMANDS.logoSet, msg);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function logoRemove(ctx: RequestContext): Promise<Accepted> {
  const { id, msg } = envelope(ctx, SETTINGS_COMMANDS.logoRemove, {});
  await queue.publish(SETTINGS_COMMANDS.logoRemove, msg);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
