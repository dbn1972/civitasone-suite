import { pino } from "pino";
import { resolveIntegration } from "@civitasone/integration-config";
import type { ChannelAdapter, SendParams, SendResult } from "./types.js";
import { createSmtpTransport, MemoryEmailTransport, type EmailTransport, type SmtpConfig } from "./email-transport.js";
import { renderBody } from "./render.js";
import { maskRecipient } from "./mask.js";

const log = pino({ name: "adapter:email" });

let testTransport: EmailTransport | null = null;

/** Override SMTP transport in tests. Pass `null` to reset. */
export function setEmailTransportForTests(transport: EmailTransport | null): void {
  testTransport = transport;
}

function resolveTransport(cfg?: SmtpConfig): EmailTransport {
  if (testTransport) return testTransport;
  return createSmtpTransport(cfg);
}

function emailDriver(): string {
  return process.env.NOTIFICATION_EMAIL_DRIVER ?? "stub";
}

type ResolvedEmail = { from: string; cfg: SmtpConfig };

/**
 * Resolve SMTP settings from the integration registry for a tenant. Returns
 * null when the registry is not wired / has no enabled email_smtp row, so the
 * caller falls back to env vars. Returns an error string when a registry row
 * exists but is incomplete (fail-closed).
 */
async function resolveFromRegistry(tenantId?: string): Promise<ResolvedEmail | { error: string } | null> {
  if (!tenantId || !process.env.INTEGRATION_REGISTRY_DB_URL) return null;
  const reg = await resolveIntegration({ provider: "email_smtp", tenantId });
  if (!reg) return null;
  const host = String(reg.config.host ?? "");
  const from = String(reg.config.from ?? "");
  if (!host || !from) return { error: "email_smtp integration is incomplete (host/from required)" };
  const cfg: SmtpConfig = { host, secure: reg.config.secure === true };
  if (reg.config.port != null) cfg.port = Number(reg.config.port);
  if (reg.config.user != null) cfg.user = String(reg.config.user);
  if (reg.secrets.password != null) cfg.pass = reg.secrets.password;
  return { from, cfg };
}

export class EmailAdapter implements ChannelAdapter {
  readonly type = "email";

  async send(params: SendParams): Promise<SendResult> {
    // 1) Registry-backed per-tenant SMTP (when wired).
    const reg = await resolveFromRegistry(params.tenantId);
    if (reg && "error" in reg) {
      return { ok: false, error: reg.error };
    }
    if (reg) {
      try {
        await resolveTransport(reg.cfg).send({
          to: params.recipient,
          from: reg.from,
          subject: params.subject ?? null,
          text: renderBody(params.body, params.variables),
        });
        log.info({ to: maskRecipient(params.recipient), subject: params.subject }, "email sent via smtp (registry)");
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "smtp send failed";
        log.warn({ err, to: maskRecipient(params.recipient) }, "email smtp delivery failed");
        return { ok: false, error: message };
      }
    }

    // 2) Env-var driver (backward compatible).
    const driver = emailDriver();

    if (driver === "stub") {
      log.debug({ to: maskRecipient(params.recipient), subject: params.subject }, "email stub — accepted without SMTP");
      return { ok: true };
    }

    if (driver !== "smtp") {
      return { ok: false, error: `email driver "${driver}" is not supported; use smtp or stub` };
    }

    const from = process.env.SMTP_FROM;
    if (!from) {
      return { ok: false, error: "SMTP_FROM is required when NOTIFICATION_EMAIL_DRIVER=smtp" };
    }
    if (!process.env.SMTP_HOST) {
      return { ok: false, error: "SMTP_HOST is required when NOTIFICATION_EMAIL_DRIVER=smtp" };
    }

    try {
      const transport = resolveTransport();
      await transport.send({
        to: params.recipient,
        from,
        subject: params.subject ?? null,
        text: renderBody(params.body, params.variables),
      });
      log.info({ to: maskRecipient(params.recipient), subject: params.subject }, "email sent via smtp");
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "smtp send failed";
      log.warn({ err, to: maskRecipient(params.recipient) }, "email smtp delivery failed");
      return { ok: false, error: message };
    }
  }
}

export const emailAdapter = new EmailAdapter();
export { MemoryEmailTransport };
