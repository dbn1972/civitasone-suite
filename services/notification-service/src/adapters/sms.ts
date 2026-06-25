import { pino } from "pino";
import type { ChannelAdapter, SendParams, SendResult } from "./types.js";
import { renderBody } from "./render.js";
import { maskRecipient } from "./mask.js";
import { postToGateway } from "./http-gateway.js";

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

    // P1-5: fail-closed. A stub driver is NOT a successful send.
    if (driver === "stub") {
      log.warn({ to: maskRecipient(params.recipient) }, NOT_CONFIGURED);
      return { ok: false, error: NOT_CONFIGURED };
    }

    if (driver !== "twilio") {
      return { ok: false, error: `SMS driver "${driver}" is not supported; use twilio` };
    }

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from) {
      // P1-5: missing creds → fail closed, never silently "ok".
      log.warn({ to: maskRecipient(params.recipient) }, NOT_CONFIGURED);
      return { ok: false, error: NOT_CONFIGURED };
    }

    // Real Twilio REST call: POST to the Messages endpoint with basic auth.
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const result = await postToGateway({
      url,
      method: "POST",
      headers: { authorization: `Basic ${auth}` },
      form: { To: params.recipient, From: from, Body: renderBody(params.body, params.variables) },
    });
    if (result.ok) log.info({ to: maskRecipient(params.recipient) }, "sms sent via twilio");
    else log.warn({ to: maskRecipient(params.recipient), error: result.error }, "twilio sms delivery failed");
    return result;
  }
}

export const smsAdapter = new SmsAdapter();
