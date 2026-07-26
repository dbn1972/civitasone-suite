import { pino } from "pino";
import { resolveIntegration } from "@civitasone/integration-config";
import type { ChannelAdapter, SendParams, SendResult } from "./types.js";
import { renderBody } from "./render.js";
import { maskRecipient } from "./mask.js";
import { postToGateway } from "./http-gateway.js";

const log = pino({ name: "adapter:whatsapp" });

const NOT_CONFIGURED =
  "WhatsApp not configured: set NOTIFICATION_WHATSAPP_DRIVER=meta and META_WHATSAPP_TOKEN, META_WHATSAPP_PHONE_ID (or configure the whatsapp_meta integration in Admin → Integrations)";

function whatsAppDriver(): string {
  return process.env.NOTIFICATION_WHATSAPP_DRIVER ?? "stub";
}

type MetaCreds = { token: string; phoneId: string; graphVersion: string };

/** Registry (per-tenant) first, then env. Null when neither is complete. */
async function resolveCreds(tenantId?: string): Promise<MetaCreds | null> {
  if (tenantId) {
    const reg = await resolveIntegration({ provider: "whatsapp_meta", tenantId });
    if (reg) {
      const token = reg.secrets.accessToken ?? "";
      const phoneId = String(reg.config.phoneNumberId ?? "");
      const graphVersion = String(reg.config.graphVersion ?? "v19.0");
      if (token && phoneId) return { token, phoneId, graphVersion };
      return null; // incomplete registry row → fail closed
    }
  }
  if (whatsAppDriver() === "stub") return null;
  if (whatsAppDriver() !== "meta") return null;
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneId = process.env.META_WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return null;
  return { token, phoneId, graphVersion: "v19.0" };
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly type = "whatsapp";

  async send(params: SendParams): Promise<SendResult> {
    const driver = whatsAppDriver();
    const usingEnv = !params.tenantId || !process.env.INTEGRATION_REGISTRY_DB_URL;
    if (usingEnv && driver !== "stub" && driver !== "meta") {
      return { ok: false, error: `WhatsApp driver "${driver}" is not supported; use meta` };
    }

    const creds = await resolveCreds(params.tenantId);
    if (!creds) {
      log.warn({ to: maskRecipient(params.recipient) }, NOT_CONFIGURED);
      return { ok: false, error: NOT_CONFIGURED };
    }

    const url = `https://graph.facebook.com/${creds.graphVersion}/${creds.phoneId}/messages`;
    const result = await postToGateway({
      url,
      method: "POST",
      headers: { authorization: `Bearer ${creds.token}` },
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
