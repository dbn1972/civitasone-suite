import { pino } from "pino";
import type { ChannelAdapter, SendParams, SendResult } from "./types.js";
import { createSmtpTransport, MemoryEmailTransport, type EmailTransport } from "./email-transport.js";
import { renderBody } from "./render.js";
import { maskRecipient } from "./mask.js";

const log = pino({ name: "adapter:email" });

let testTransport: EmailTransport | null = null;

/** Override SMTP transport in tests. Pass `null` to reset. */
export function setEmailTransportForTests(transport: EmailTransport | null): void {
  testTransport = transport;
}

function resolveTransport(): EmailTransport {
  if (testTransport) return testTransport;
  return createSmtpTransport();
}

function emailDriver(): string {
  return process.env.NOTIFICATION_EMAIL_DRIVER ?? "stub";
}

export class EmailAdapter implements ChannelAdapter {
  readonly type = "email";

  async send(params: SendParams): Promise<SendResult> {
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
