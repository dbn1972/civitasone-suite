/**
 * Conversation command publishers — routes queue these instead of writing directly.
 */
import { queue } from "../../shared/infra.js";

export const CONVERSATION_COMMANDS = {
  create: "notification.conversation.create",
  addMessage: "notification.conversation.add_message",
  update: "notification.conversation.update",
} as const;

export interface CreateConversationPayload {
  contactId: string;
  channel: string;
  subject: string | null;
  providerThreadId: string | null;
  assignedTo: string | null;
}

export interface AddMessagePayload {
  conversationId: string;
  direction: string;
  content: string | null;
  contentType: string;
  providerMessageId: string | null;
  status: string;
}

export interface UpdateConversationPayload {
  conversationId: string;
  status?: string | undefined;
  assignedTo?: string | null | undefined;
  subject?: string | undefined;
}

export function publishCreateConversation(
  tenantId: string, actorId: string, correlationId: string, payload: CreateConversationPayload,
): Promise<string> {
  return queue.publish(CONVERSATION_COMMANDS.create, {
    type: CONVERSATION_COMMANDS.create,
    tenantId, actorId, correlationId, schemaVersion: "1.0",
    payload,
  });
}

export function publishAddMessage(
  tenantId: string, actorId: string, correlationId: string, payload: AddMessagePayload,
): Promise<string> {
  return queue.publish(CONVERSATION_COMMANDS.addMessage, {
    type: CONVERSATION_COMMANDS.addMessage,
    tenantId, actorId, correlationId, schemaVersion: "1.0",
    payload,
  });
}

export function publishUpdateConversation(
  tenantId: string, actorId: string, correlationId: string, payload: UpdateConversationPayload,
): Promise<string> {
  return queue.publish(CONVERSATION_COMMANDS.update, {
    type: CONVERSATION_COMMANDS.update,
    tenantId, actorId, correlationId, schemaVersion: "1.0",
    payload,
  });
}
