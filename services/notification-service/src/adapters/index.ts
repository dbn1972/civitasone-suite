import type { ChannelAdapter } from "./types.js";
import { emailAdapter, setEmailTransportForTests, MemoryEmailTransport } from "./email.js";
import { smsAdapter } from "./sms.js";
import { pushAdapter } from "./push.js";
import { inAppAdapter } from "./in_app.js";
import { whatsAppAdapter } from "./whatsapp.js";
import { setNotificationPublisherForTests, MemoryNotificationPublisher } from "./pubsub.js";

export type { SendParams, SendResult, ChannelAdapter } from "./types.js";
export { setEmailTransportForTests, MemoryEmailTransport, setNotificationPublisherForTests, MemoryNotificationPublisher };

const adapters: Record<string, ChannelAdapter> = {
  email:    emailAdapter,
  sms:      smsAdapter,
  push:     pushAdapter,
  in_app:   inAppAdapter,
  whatsapp: whatsAppAdapter,
};

export function getAdapter(type: string): ChannelAdapter | undefined {
  return adapters[type];
}

export function getAdapterOrThrow(type: string): ChannelAdapter {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`unknown channel adapter: ${type}`);
  return adapter;
}

export { emailAdapter, smsAdapter, pushAdapter, inAppAdapter, whatsAppAdapter };
