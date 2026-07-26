import { pino } from "pino";
import { resolveIntegration } from "@civitasone/integration-config";
import type { ChannelAdapter, SendParams, SendResult } from "./types.js";
import { renderBody } from "./render.js";
import { maskRecipient } from "./mask.js";
import { postToGateway } from "./http-gateway.js";

const log = pino({ name: "adapter:sms" });

const NOT_CONFIGURED =
  "SMS not configured: set NOTIFICATION_SMS_DRIVER=twilio and TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (or configure the sms_twilio integration in Admin → Integrations)";

function smsDriver(): string {
  return process.env.NOTIFICATION_SMS_DRIVER ?? "stub";
}

type TwilioCreds = { sid: string; token: string; from: string };

/**
 * Resolve Twilio credentials from the integration registry (per-tenant) first,
 * falling back to environment variables. Returns null when neither source is
 * fully configured (fail-closed at the call site).
 */
async function resolveCreds(tenantId?: string): Promise<TwilioCreds | null> {
  if (tenantId) {
    const reg = await resolveIntegration({ provider: "sms_twilio", tenantId });
    if (reg) {
      const sid = String(reg.config.accountSid ?? "");
      const token = reg.secrets.authToken ?? "";
      const from = String(reg.config.fromNumber ?? "");
      if (sid && token && from) return { sid, token, from };
      // A registry row exists but is incomplete → fail closed, do not fall back.
      return null;
    }
  }
  // Env fallback (backward compatible).
  if (smsDriver() === "stub") return null;
  if (smsDriver() !== "twilio") return null;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return null;
  return { sid, token, from };
}

export class SmsAdapter implements ChannelAdapter {
  readonly type = "sms";

  async send(params: SendParams): Promise<SendResult> {
    // An explicitly unsupported env driver is a distinct, actionable error.
    const driver = smsDriver();
    const usingEnv = !params.tenantId || !process.env.INTEGRATION_REGISTRY_DB_URL;
    if (usingEnv && driver !== "stub" && driver !== "twilio") {
      return { ok: false, error: `SMS driver "${driver}" is not supported; use twilio` };
    }

    const creds = await resolveCreds(params.tenantId);
    if (!creds) {
      // P1-5: fail-closed. Never a silent "ok" without real credentials.
      log.warn({ to: maskRecipient(params.recipient) }, NOT_CONFIGURED);
      return { ok: false, error: NOT_CONFIGURED };
    }

    // Real Twilio REST call: POST to the Messages endpoint with basic auth.
    const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Messages.json`;
    const auth = Buffer.from(`${creds.sid}:${creds.token}`).toString("base64");
    const result = await postToGateway({
      url,
      method: "POST",
      headers: { authorization: `Basic ${auth}` },
      form: { To: params.recipient, From: creds.from, Body: renderBody(params.body, params.variables) },
    });
    if (result.ok) log.info({ to: maskRecipient(params.recipient) }, "sms sent via twilio");
    else log.warn({ to: maskRecipient(params.recipient), error: result.error }, "twilio sms delivery failed");
    return result;
  }
}

export const smsAdapter = new SmsAdapter();
