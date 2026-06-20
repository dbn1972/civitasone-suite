import { pino } from "pino";
import type { ChannelAdapter, SendParams, SendResult } from "./types.js";
import { renderBody } from "./render.js";

const log = pino({ name: "adapter:whatsapp" });

const NOT_CONFIGURED =
  "WhatsApp not configured: set NOTIFICATION_WHATSAPP_DRIVER=meta and META_WHATSAPP_TOKEN, META_WHATSAPP_PHONE_ID";

function whatsAppDriver(): string {
  return process.env.NOTIFICATION_WHATSAPP_DRIVER ?? "stub";
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly type = "whatsapp";

  async send(params: SendParams): Promise<SendResult> {
    const driver = whatsAppDriver();

    if (driver === "stub") {
      log.warn({ to: params.recipient }, NOT_CONFIGURED);
      return { ok: false, error: NOT_CONFIGURED };
    }

    if (driver !== "meta") {
      return { ok: false, error: `WhatsApp driver "${driver}" is not supported; use meta` };
    }

    const token = process.env.META_WHATSAPP_TOKEN;
    const phoneId = process.env.META_WHATSAPP_PHONE_ID;
    if (!token || !phoneId) {
      log.warn({ to: params.recipient }, NOT_CONFIGURED);
      return { ok: false, error: NOT_CONFIGURED };
    }

    log.warn({ to: params.recipient }, "meta WhatsApp driver selected but REST client not implemented");
    void renderBody(params.body, params.variables);
    return { ok: false, error: "WhatsApp Business API delivery is not implemented yet" };
  }
}

export const whatsAppAdapter = new WhatsAppAdapter();
