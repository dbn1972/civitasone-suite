import { pino } from "pino";
import type { ChannelAdapter, SendParams, SendResult } from "./types.js";
import { renderBody } from "./render.js";
import { maskRecipient } from "./mask.js";
import { postToGateway } from "./http-gateway.js";

const log = pino({ name: "adapter:push" });

const NOT_CONFIGURED =
  "Push not configured: set NOTIFICATION_PUSH_DRIVER=firebase and FIREBASE_SERVER_KEY";

export class PushAdapter implements ChannelAdapter {
  readonly type = "push";

  async send(params: SendParams): Promise<SendResult> {
    const driver = process.env.NOTIFICATION_PUSH_DRIVER ?? "stub";

    // P1-5: fail-closed. Stub driver OR missing server key is NOT a successful send.
    if (driver === "stub") {
      log.warn({ to: maskRecipient(params.recipient) }, NOT_CONFIGURED);
      return { ok: false, error: NOT_CONFIGURED };
    }

    if (driver !== "firebase") {
      return { ok: false, error: `Push driver "${driver}" is not supported; use firebase` };
    }

    const serverKey = process.env.FIREBASE_SERVER_KEY;
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
