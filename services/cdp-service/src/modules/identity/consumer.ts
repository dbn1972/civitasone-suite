import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as profilesRepo from "../profiles/repo.js";
import * as stewardRepo from "../steward/repo.js";
import { hashIdentifier, deterministicConfidence } from "./domain.js";

const log = pino({ name: "cdp.identity.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerIdentityConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.resolveIdentity, async (msg) => {
    const p = msg.payload as {
      id: string;
      action: "create" | "ambiguous";
      identifiers?: Array<{ type: string; value: string }>;
      attributes?: Record<string, unknown>;
      sourceProfileId?: string;
      targetProfileId?: string;
      confidence?: string;
      matchReason?: string;
    };

    if (p.action === "ambiguous") {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await stewardRepo.insert(tx, {
          tenantId: msg.tenantId,
          sourceProfileId: p.sourceProfileId!,
          targetProfileId: p.targetProfileId!,
          confidence: p.confidence!,
          matchReason: p.matchReason!,
          status: "pending",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        await writeAudit(tx, ctxOf(msg), {
          action: "identity.ambiguous",
          resourceType: "merge_queue",
          resourceId: p.id,
        });
      });
      log.info({ id: p.id }, "ambiguous match queued for steward");
      return;
    }

    const profileId = p.id;
    const identifiers = p.identifiers ?? [];
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await profilesRepo.insert(tx, {
        id: profileId,
        tenantId: msg.tenantId,
        profileType: "individual",
        attributes: p.attributes ?? {},
        sourceLineage: [{
          source: "identity_resolution",
          sourceId: msg.correlationId,
          timestamp: new Date().toISOString(),
        }],
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      for (const ident of identifiers) {
        await repo.insert(tx, {
          tenantId: msg.tenantId,
          profileId,
          identifierType: ident.type,
          identifierHash: hashIdentifier(ident.type, ident.value),
          confidence: String(deterministicConfidence(ident.type)),
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
      }
      await enqueue(tx, {
        topic: EVENTS.identityResolved,
        eventType: EVENTS.identityResolved,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { profileId, identifiers, outcome: "created" },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "identity.resolve_create",
        resourceType: "profile",
        resourceId: profileId,
      });
    });
    log.info({ id: profileId }, "identity resolve created profile");
  });

  queue.subscribe(COMMANDS.identityUnlink, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findById(p.id, msg.tenantId);
      if (!existing) return;
      const deleted = await repo.deleteById(tx, p.id, msg.tenantId);
      if (!deleted) return;
      await writeAudit(tx, ctxOf(msg), {
        action: "identity.unlink",
        resourceType: "identity_graph",
        resourceId: p.id,
        details: { profileId: existing.profileId, identifierType: existing.identifierType },
      });
    });
  });
}
