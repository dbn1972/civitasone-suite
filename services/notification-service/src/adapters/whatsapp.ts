import { pino } from "pino";
import type { ChannelAdapter, SendParams, SendResult } from "./types.js";
import { renderBody } from "./render.js";
import { maskRecipient } from "./mask.js";
import { postToGateway } from "./http-gateway.js";

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

    // P1-5: fail-closed. A stub driver is NOT a successful send.
    if (driver === "stub") {
      log.warn({ to: maskRecipient(params.recipient) }, NOT_CONFIGURED);
      return { ok: false, error: NOT_CONFIGURED };
    }

    if (driver !== "meta") {
      return { ok: false, error: `WhatsApp driver "${driver}" is not supported; use meta` };
    }

    const token = process.env.META_WHATSAPP_TOKEN;
    const phoneId = process.env.META_WHATSAPP_PHONE_ID;
    if (!token || !phoneId) {
      // P1-5: missing creds → fail closed, never silently "ok".
      log.warn({ to: maskRecipient(params.recipient) }, NOT_CONFIGURED);
      return { ok: false, error: NOT_CONFIGURED };
    }

    // Real Meta WhatsApp Cloud API call.
    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
    const result = await postToGateway({
      url,
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      json: {
        messaging_product: "whatsapp",
        to: params.recipient,
        type: "text",
        text: { body: renderBody(params.body, params.variables) },
      },
    });
    if (result.ok) log.info({ to: maskRecipient(params.recipient) }, "whatsapp sent via meta");
    else log.warn({ to: maskRecipient(params.recipient), error: result.error }, "meta whatsapp delivery failed");
    return result;
  }
}

export const whatsAppAdapter = new WhatsAppAdapter();
