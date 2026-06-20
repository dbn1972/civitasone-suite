import { pino } from "pino";
import type { ChannelAdapter, SendParams, SendResult } from "./types.js";
import { renderBody } from "./render.js";

const log = pino({ name: "adapter:sms" });

const NOT_CONFIGURED =
  "SMS not configured: set NOTIFICATION_SMS_DRIVER=twilio and TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM";

function smsDriver(): string {
  return process.env.NOTIFICATION_SMS_DRIVER ?? "stub";
}

export class SmsAdapter implements ChannelAdapter {
  readonly type = "sms";

  async send(params: SendParams): Promise<SendResult> {
    const driver = smsDriver();

    if (driver === "stub") {
      log.warn({ to: params.recipient }, NOT_CONFIGURED);
      return { ok: false, error: NOT_CONFIGURED };
    }

    if (driver !== "twilio") {
      return { ok: false, error: `SMS driver "${driver}" is not supported; use twilio` };
    }

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from) {
      log.warn({ to: params.recipient }, NOT_CONFIGURED);
      return { ok: false, error: NOT_CONFIGURED };
    }

    // Twilio REST integration is future work — fail loudly instead of silent stub.
    log.warn({ to: params.recipient }, "twilio SMS driver selected but REST client not implemented");
    void renderBody(params.body, params.variables);
    return { ok: false, error: "Twilio SMS delivery is not implemented yet" };
  }
}

export const smsAdapter = new SmsAdapter();
