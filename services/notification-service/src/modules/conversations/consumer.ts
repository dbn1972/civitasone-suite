/**
 * Conversation consumer — processes conversation commands via CQRS pattern.
 * Each handler: markProcessed → DB write → enqueue audit event.
 */
import { pino } from "pino";
import { eq, and, sql } from "drizzle-orm";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { conversations, conversationMessages } from "./schema.js";
import {
  CONVERSATION_COMMANDS,
  type CreateConversationPayload,
  type AddMessagePayload,
  type UpdateConversationPayload,
} from "./commands.js";

const log = pino({ name: "consumer:conversations" });

const AUDIT_TOPIC = "audit.event.record";

export function registerConversationConsumers(queue: Queue): void {
  // Create conversation
  queue.subscribe<CreateConversationPayload>(CONVERSATION_COMMANDS.create, async (msg) => {
    const { tenantId, actorId, correlationId, payload } = msg;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const [row] = await tx.insert(conversations).values({
        tenantId,
        contactId: payload.contactId,
        channel: payload.channel,
        subject: payload.subject,
        providerThreadId: payload.providerThreadId,
        assignedTo: payload.assignedTo,
        createdBy: actorId,
        updatedBy: actorId,
      }).returning();

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: "conversation.created",
        tenantId,
        actorId,
        correlationId,
        payload: {
          resourceType: "conversation",
          resourceId: row!.id,
        },
      });

      log.info({ conversationId: row!.id, tenantId }, "conversation created");
    });
  });

  // Add message to conversation
  queue.subscribe<AddMessagePayload>(CONVERSATION_COMMANDS.addMessage, async (msg) => {
    const { tenantId, actorId, correlationId, payload } = msg;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const now = new Date();

      const [inserted] = await tx.insert(conversationMessages).values({
        tenantId,
        conversationId: payload.conversationId,
        direction: payload.direction,
        content: payload.content,
        contentType: payload.contentType,
        providerMessageId: payload.providerMessageId,
        status: payload.status,
        createdBy: actorId,
      }).returning();

      // Update conversation last_message_at and message_count
      await tx.update(conversations)
        .set({
          lastMessageAt: now,
          messageCount: sql`${conversations.messageCount} + 1`,
          updatedAt: now,
          updatedBy: actorId,
        })
        .where(and(eq(conversations.id, payload.conversationId), eq(conversations.tenantId, tenantId)));

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: "conversation.message_added",
        tenantId,
        actorId,
        correlationId,
        payload: {
          resourceType: "conversation_message",
          resourceId: inserted!.id,
          conversationId: payload.conversationId,
        },
      });

      log.info({ messageId: inserted!.id, conversationId: payload.conversationId, tenantId }, "message added");
    });
  });

  // Update conversation (status/assign)
  queue.subscribe<UpdateConversationPayload>(CONVERSATION_COMMANDS.update, async (msg) => {
    const { tenantId, actorId, correlationId, payload } = msg;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${conversations.version} + 1`,
      };
      if (payload.status !== undefined) {
        updates.status = payload.status;
        if (payload.status === "closed") updates.closedAt = new Date();
      }
      if (payload.assignedTo !== undefined) updates.assignedTo = payload.assignedTo;
      if (payload.subject !== undefined) updates.subject = payload.subject;

      await tx.update(conversations)
        .set(updates)
        .where(and(eq(conversations.id, payload.conversationId), eq(conversations.tenantId, tenantId)));

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: "conversation.updated",
        tenantId,
        actorId,
        correlationId,
        payload: {
          resourceType: "conversation",
          resourceId: payload.conversationId,
        },
      });

      log.info({ conversationId: payload.conversationId, tenantId }, "conversation updated");
    });
  });
}
