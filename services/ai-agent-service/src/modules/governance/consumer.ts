import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as orchRepo from "../agents/orchestration-repo.js";
import * as qualityRepo from "./quality-repo.js";

const log = pino({ name: "ai.governance.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, roles: [] as string[] };
}

export function registerGovernanceConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.startOrchestration, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      rootAgentId: string;
      maxDepth: number;
      maxHops: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await orchRepo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        rootAgentId: p.rootAgentId,
        status: "running",
        depth: 0,
        maxDepth: p.maxDepth,
        hopCount: 0,
        maxHops: p.maxHops,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.orchestrationStarted,
        eventType: EVENTS.orchestrationStarted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { orchestrationId: p.id, rootAgentId: p.rootAgentId, maxDepth: p.maxDepth, maxHops: p.maxHops },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        agentId: p.rootAgentId,
        action: "orchestration.start",
        input: null,
        output: p.id,
        blocked: false,
        reason: null,
      });
    });
    await cache.invalidateResource(msg.tenantId, "orchestration");
    log.info({ id: p.id }, "orchestration started");
  });

  queue.subscribe(COMMANDS.recordHandoff, async (msg) => {
    const p = msg.payload as {
      orchestrationId: string;
      hopId: string;
      tenantId: string;
      fromAgentId: string;
      toAgentId: string;
      reason: string;
      nextDepth: number;
      nextHopCount: number;
      version: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await orchRepo.insertHop(tx, {
        id: p.hopId,
        tenantId: p.tenantId,
        orchestrationId: p.orchestrationId,
        fromAgentId: p.fromAgentId,
        toAgentId: p.toAgentId,
        depth: p.nextDepth,
        reason: p.reason,
      });
      const ok = await orchRepo.update(
        tx,
        p.orchestrationId,
        p.tenantId,
        { depth: p.nextDepth, hopCount: p.nextHopCount, updatedBy: msg.actorId },
        p.version,
      );
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.orchestrationHopRecorded,
        eventType: EVENTS.orchestrationHopRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          orchestrationId: p.orchestrationId,
          hopId: p.hopId,
          fromAgentId: p.fromAgentId,
          toAgentId: p.toAgentId,
          depth: p.nextDepth,
          hopCount: p.nextHopCount,
        },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        agentId: p.fromAgentId,
        action: "orchestration.handoff",
        input: null,
        output: p.toAgentId,
        blocked: false,
        reason: null,
      });
    });
    await cache.invalidateResource(msg.tenantId, "orchestration");
  });

  queue.subscribe(COMMANDS.abortOrchestration, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string; version: number };
    const orchestration = await orchRepo.findById(p.id, p.tenantId);
    if (!orchestration) return;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await orchRepo.update(
        tx,
        p.id,
        p.tenantId,
        { status: "aborted", reason: p.reason, completedAt: new Date(), updatedBy: msg.actorId },
        p.version,
      );
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.orchestrationAborted,
        eventType: EVENTS.orchestrationAborted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { orchestrationId: p.id, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg) as never, {
        agentId: orchestration.rootAgentId,
        action: "orchestration.abort",
        input: null,
        output: null,
        blocked: false,
        reason: p.reason,
      });
    });
    await cache.invalidateResource(msg.tenantId, "orchestration");
  });

  queue.subscribe(COMMANDS.scoreInteraction, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      conversationId: string;
      turnId: string;
      relevance: string;
      coherence: string;
      safety: string;
      overall: string;
      flagged: boolean;
      flagReason: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await qualityRepo.upsert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        conversationId: p.conversationId,
        turnId: p.turnId,
        relevance: p.relevance,
        coherence: p.coherence,
        safety: p.safety,
        overall: p.overall,
        flagged: p.flagged,
        flagReason: p.flagReason,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.interactionScored,
        eventType: EVENTS.interactionScored,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          conversationId: p.conversationId,
          turnId: p.turnId,
          overall: p.overall,
          flagged: p.flagged,
        },
      });
      if (p.flagged) {
        await enqueue(tx, {
          topic: EVENTS.interactionFlagged,
          eventType: EVENTS.interactionFlagged,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { conversationId: p.conversationId, turnId: p.turnId, flagReason: p.flagReason },
        });
      }
      await writeAudit(tx, ctxOf(msg) as never, {
        action: "quality.score",
        input: null,
        output: p.overall,
        blocked: false,
        reason: p.flagReason,
      });
    });
    await cache.invalidateResource(msg.tenantId, "quality-flagged");
    await cache.invalidateResource(msg.tenantId, "quality-conversation");
  });
}
