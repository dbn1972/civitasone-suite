import { pino } from "pino";
import type { ChannelAdapter, SendParams, SendResult } from "./types.js";

const log = pino({ name: "adapter:push" });

const NOT_CONFIGURED =
  "Push not configured: set NOTIFICATION_PUSH_DRIVER=firebase and FIREBASE_SERVER_KEY";

export class PushAdapter implements ChannelAdapter {
  readonly type = "push";

  async send(params: SendParams): Promise<SendResult> {
    const driver = process.env.NOTIFICATION_PUSH_DRIVER ?? "stub";

    if (driver === "stub" || !process.env.FIREBASE_SERVER_KEY) {
      log.warn({ to: params.recipient }, NOT_CONFIGURED);
      return { ok: false, error: NOT_CONFIGURED };
    }

    return { ok: false, error: "Firebase push delivery is not implemented yet" };
  }
}

export const pushAdapter = new PushAdapter();
