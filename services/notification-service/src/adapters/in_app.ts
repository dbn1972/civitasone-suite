import { pino } from "pino";
import type { ChannelAdapter, SendParams, SendResult } from "./types.js";
import { createNotificationPublisher } from "./pubsub.js";
import { renderBody } from "./render.js";

const log = pino({ name: "adapter:in_app" });

export function inAppChannel(tenantId: string, userId: string): string {
  return `notifications:${tenantId}:${userId}`;
}

export class InAppAdapter implements ChannelAdapter {
  readonly type = "in_app";

  async send(params: SendParams): Promise<SendResult> {
    const tenantId = params.tenantId;
    const userId = params.userId ?? params.recipient;
    if (!tenantId) {
      return { ok: false, error: "tenantId is required for in_app delivery" };
    }

    const channel = inAppChannel(tenantId, userId);
    const payload = {
      subject: params.subject ?? null,
      body: renderBody(params.body, params.variables),
      variables: params.variables ?? {},
      at: new Date().toISOString(),
    };

    try {
      const publisher = createNotificationPublisher();
      await publisher.publish(channel, payload);
      log.info({ channel, userId }, "in_app notification published");
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "in_app publish failed";
      log.warn({ err, channel }, "in_app delivery failed");
      return { ok: false, error: message };
    }
  }
}

export const inAppAdapter = new InAppAdapter();
