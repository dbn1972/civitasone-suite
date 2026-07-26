import { pino } from "pino";
import { resolveIntegration } from "@civitasone/integration-config";
import type { ChannelAdapter, SendParams, SendResult } from "./types.js";
import { renderBody } from "./render.js";
import { maskRecipient } from "./mask.js";
import { postToGateway } from "./http-gateway.js";

const log = pino({ name: "adapter:push" });

const NOT_CONFIGURED =
  "Push not configured: set NOTIFICATION_PUSH_DRIVER=firebase and FIREBASE_SERVER_KEY (or configure the push_fcm integration in Admin → Integrations)";

function pushDriver(): string {
  return process.env.NOTIFICATION_PUSH_DRIVER ?? "stub";
}

/** Registry (per-tenant) first, then env. Null when no server key is available. */
async function resolveServerKey(tenantId?: string): Promise<string | null> {
  if (tenantId) {
    const reg = await resolveIntegration({ provider: "push_fcm", tenantId });
    if (reg) {
      const key = reg.secrets.serverKey ?? "";
      return key || null; // incomplete registry row → fail closed
    }
  }
  if (pushDriver() === "stub") return null;
  if (pushDriver() !== "firebase") return null;
  return process.env.FIREBASE_SERVER_KEY ?? null;
}

export class PushAdapter implements ChannelAdapter {
  readonly type = "push";

  async send(params: SendParams): Promise<SendResult> {
    const driver = pushDriver();
    const usingEnv = !params.tenantId || !process.env.INTEGRATION_REGISTRY_DB_URL;
    if (usingEnv && driver !== "stub" && driver !== "firebase") {
      return { ok: false, error: `Push driver "${driver}" is not supported; use firebase` };
    }

    const serverKey = await resolveServerKey(params.tenantId);
    if (!serverKey) {
      log.warn({ to: maskRecipient(params.recipient) }, NOT_CONFIGURED);
      return { ok: false, error: NOT_CONFIGURED };
    }

    // Real FCM legacy HTTP call. `recipient` is the device registration token.
    const result = await postToGateway({
      url: "https://fcm.googleapis.com/fcm/send",
      method: "POST",
      headers: { authorization: `key=${serverKey}` },
      json: {
        to: params.recipient,
        notification: {
          title: params.subject ?? "Notification",
          body: renderBody(params.body, params.variables),
        },
      },
    });
    if (result.ok) log.info({ to: maskRecipient(params.recipient) }, "push sent via firebase");
    else log.warn({ to: maskRecipient(params.recipient), error: result.error }, "firebase push delivery failed");
    return result;
  }
}

export const pushAdapter = new PushAdapter();
