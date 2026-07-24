import { pino } from "pino";
import type { ChannelAdapter, SendParams, SendResult } from "./types.js";
import { signPayload } from "../modules/webhook/domain.js";

const log = pino({ name: "notification:webhook-adapter" });
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

export interface WebhookSendParams extends SendParams {
  /** The webhook endpoint URL. */
  endpointUrl: string;
  /** HMAC secret for signing the payload. */
  endpointSecret: string;
  /** Unique delivery ID for the X-Delivery-Id header. */
  deliveryId: string;
}

/**
 * Webhook channel adapter — delivers notifications via HTTP POST to a registered endpoint.
 * Includes HMAC-SHA256 signature in X-Signature-256 header.
 * Retries up to 3 times with exponential backoff (1s, 2s, 4s) on 5xx responses.
 * Timeout: 10 seconds per attempt.
 */
export const webhookAdapter: ChannelAdapter = {
  type: "webhook",

  async send(params: SendParams): Promise<SendResult> {
    const p = params as WebhookSendParams;
    if (!p.endpointUrl || !p.endpointSecret) {
      return { ok: false, error: "Missing endpointUrl or endpointSecret for webhook delivery" };
    }

    const body = JSON.stringify({
      recipient: p.recipient,
      subject: p.subject ?? null,
      body: p.body,
      variables: p.variables ?? {},
    });

    const signature = signPayload(body, p.endpointSecret);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const response = await fetch(p.endpointUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Signature-256": `sha256=${signature}`,
            "X-Delivery-Id": p.deliveryId ?? "unknown",
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          return { ok: true };
        }

        if (response.status >= 500) {
          // Retryable server error
          if (attempt < MAX_RETRIES - 1) {
            const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
            log.warn({ attempt, status: response.status, deliveryId: p.deliveryId }, `webhook returned ${response.status}, retrying in ${delay}ms`);
            await sleep(delay);
            continue;
          }
          return { ok: false, error: `Webhook returned ${response.status} after ${MAX_RETRIES} attempts` };
        }

        // 4xx — non-retryable
        return { ok: false, error: `Webhook returned ${response.status}` };
      } catch (err) {
        const isTimeout = err instanceof DOMException && err.name === "AbortError";
        if (isTimeout) {
          if (attempt < MAX_RETRIES - 1) {
            const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
            log.warn({ attempt, deliveryId: p.deliveryId }, `webhook timed out, retrying in ${delay}ms`);
            await sleep(delay);
            continue;
          }
          return { ok: false, error: `Webhook timed out after ${MAX_RETRIES} attempts` };
        }
        return { ok: false, error: `Webhook delivery failed: ${(err as Error).message}` };
      }
    }

    return { ok: false, error: "Webhook delivery exhausted all retries" };
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
