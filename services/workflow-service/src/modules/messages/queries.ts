import * as repo from "./repo.js";
import type { MessageSubscriptionRow, SignalSubscriptionRow } from "./schema.js";

export interface InstanceSubscriptions {
  messages: MessageSubscriptionRow[];
  signals: SignalSubscriptionRow[];
}

/**
 * List all message and signal subscriptions for a workflow instance.
 * Used by the UI to show what an instance is currently waiting for.
 */
export async function listSubscriptionsForInstance(
  instanceId: string,
): Promise<InstanceSubscriptions> {
  return repo.findSubscriptionsByInstance(instanceId);
}
