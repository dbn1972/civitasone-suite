import { z } from "zod";

/** Deliver a message to a waiting subscription by name + correlationKey. */
export const deliverMessageBody = z.object({
  messageName: z.string().min(1).max(128).regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/),
  correlationKey: z.string().min(1).max(256),
  payload: z.record(z.unknown()).optional().default({}),
});

export type DeliverMessageBody = z.infer<typeof deliverMessageBody>;

/** Broadcast a signal to all active subscribers by name. */
export const broadcastSignalBody = z.object({
  signalName: z.string().min(1).max(128).regex(/^[a-zA-Z][a-zA-Z0-9._-]*$/),
  payload: z.record(z.unknown()).optional().default({}),
});

export type BroadcastSignalBody = z.infer<typeof broadcastSignalBody>;

/** Query subscriptions for an instance. */
export const instanceIdParam = z.object({
  instanceId: z.string().uuid(),
});

export type InstanceIdParam = z.infer<typeof instanceIdParam>;
