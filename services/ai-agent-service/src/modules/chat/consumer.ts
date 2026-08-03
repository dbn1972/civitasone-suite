import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { HandoffContext } from "./domain.js";

const log = pino({ name: "ai.chat.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, roles: [] as string[] };
}

export function registerChatConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.sendMessage, async (msg) => {
    const p = msg.payload as {
      tenantId: string;
      conversationId: string;
      messageId: string;
      isNew: boolean;
      channelId: string;
      profileId: string;
      language: string;
      sanitizedInput: string;
      tokens: number;
      violationCount: number;
      role?: string;
      sessionMessage?: boolean;
      handoff?: {
        reasonCode: string;
        note: string | null;
        queue: string | null;
        context: HandoffContext;
      } | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      if (p.isNew) {
        await repo.insert(tx, {
          id: p.conversationId,
          tenantId: p.tenantId,
          channelId: p.channelId,
          profileId: p.profileId,
          status: "active",
          language: p.language,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        await enqueue(tx, {
          topic: EVENTS.conversationStarted,
          eventType: EVENTS.conversationStarted,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { conversationId: p.conversationId, channelId: p.channelId, language: p.language },
        });
      }

      const role = p.role ?? "user";
      await repo.insertMessage(tx, {
        id: p.messageId,
        tenantId: p.tenantId,
        conversationId: p.conversationId,
        role,
        content: p.sanitizedInput,
        tokens: p.tokens,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.turnCompleted,
        eventType: EVENTS.turnCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          conversationId: p.conversationId,
          messageId: p.messageId,
          role,
          tokens: p.tokens,
          violations: p.violationCount,
        },
      });

      await writeAudit(tx, ctxOf(msg) as never, {
        action: p.sessionMessage ? "chat.session_message" : "chat.send",
        input: p.sanitizedInput,
        output: null,
        blocked: false,
        reason: p.violationCount > 0 ? "guardrail warnings recorded" : null,
      });

      if (p.handoff) {
        const escalated = await repo.markHandedOff(tx, p.conversationId, p.tenantId, {
          handoffReason: p.handoff.reasonCode,
          handoffNote: p.handoff.note,
          handoffQueue: p.handoff.queue,
          handoffContext: p.handoff.context,
          updatedBy: msg.actorId,
        });

        if (escalated) {
          await enqueue(tx, {
            topic: EVENTS.conversationHandedOff,
            eventType: EVENTS.conversationHandedOff,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: {
              conversationId: p.conversationId,
              reasonCode: p.handoff.reasonCode,
              queue: p.handoff.queue,
              context: p.handoff.context,
            },
          });

          await writeAudit(tx, ctxOf(msg) as never, {
            action: "chat.handoff",
            input: null,
            output: null,
            blocked: false,
            reason: p.handoff.reasonCode,
          });
        }
      }
    });
    log.info({ conversationId: p.conversationId, messageId: p.messageId }, "chat message accepted");
  });

  queue.subscribe(COMMANDS.endConversation, async (msg) => {
    const p = msg.payload as {
      conversationId: string;
      tenantId: string;
      version: number;
      reason: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(
        tx,
        p.conversationId,
        msg.tenantId,
        { status: "ended", endedAt: new Date(), updatedBy: msg.actorId },
        p.version,
      );
      if (!ok) return;
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "chat.end",
        input: null,
        output: null,
        blocked: false,
        reason: p.reason,
      });
    });
  });

  queue.subscribe(COMMANDS.handOffConversation, async (msg) => {
    const p = msg.payload as {
      conversationId: string;
      tenantId: string;
      version: number;
      reasonCode: string;
      note: string | null;
      queue: string | null;
      context: HandoffContext;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(
        tx,
        p.conversationId,
        msg.tenantId,
        {
          status: "handed_off",
          handedOffAt: new Date(),
          handoffReason: p.reasonCode,
          handoffNote: p.note,
          handoffQueue: p.queue,
          handoffContext: p.context,
          updatedBy: msg.actorId,
        },
        p.version,
        "active",
      );
      // A lost race means another writer already moved the conversation on;
      // re-applying would overwrite their state.
      if (!ok) return;

      await enqueue(tx, {
        topic: EVENTS.conversationHandedOff,
        eventType: EVENTS.conversationHandedOff,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          conversationId: p.conversationId,
          reasonCode: p.reasonCode,
          queue: p.queue,
          context: p.context,
        },
      });

      await writeAudit(tx, ctxOf(msg) as never, {
        action: "chat.handoff",
        input: null,
        output: null,
        blocked: false,
        reason: p.note ?? p.reasonCode,
      });
    });
    log.info(
      { conversationId: p.conversationId, reasonCode: p.reasonCode },
      "chat conversation handed off to a human",
    );
  });

  queue.subscribe(COMMANDS.startChatSession, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; channelId: string; profileId: string; language: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id, tenantId: p.tenantId, channelId: p.channelId, profileId: p.profileId,
        status: "active", language: p.language, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.conversationStarted, eventType: EVENTS.conversationStarted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { conversationId: p.id, channelId: p.channelId, language: p.language },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "chat.session_start", input: null, output: p.id, blocked: false, reason: null,
      });
    });
    log.info({ id: p.id }, "chat session started");
  });
}
