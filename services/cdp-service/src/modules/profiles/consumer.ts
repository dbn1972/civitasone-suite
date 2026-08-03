import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { mergeProfiles as mergeDomain } from "./domain.js";

const log = pino({ name: "cdp.profiles.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

async function invalidateProfile(tenantId: string, id: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, "profile", id));
}

export function registerProfileConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.profileCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      profileType: string;
      attributes: Record<string, unknown>;
      sourceLineage: Array<{ source: string; sourceId: string; timestamp: string }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        profileType: p.profileType,
        attributes: p.attributes,
        sourceLineage: p.sourceLineage,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.profileCreated,
        eventType: EVENTS.profileCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { profileId: p.id, profileType: p.profileType, attributes: p.attributes },
      });
      await writeAudit(tx, ctxOf(msg), { action: "profile.create", resourceType: "profile", resourceId: p.id });
    });
    log.info({ id: p.id }, "profile created");
  });

  queue.subscribe(COMMANDS.profileUpdate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number; patch: Record<string, unknown> };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, p.patch, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.profileUpdated,
        eventType: EVENTS.profileUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { profileId: p.id, patch: p.patch },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "profile.update",
        resourceType: "profile",
        resourceId: p.id,
        details: { fields: Object.keys(p.patch) },
      });
    });
    if (applied) await invalidateProfile(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.mergeProfiles, async (msg) => {
    const p = msg.payload as { winnerId: string; loserId: string; tenantId: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const winner = await repo.findByIdTx(tx, p.winnerId, msg.tenantId);
      const loser = await repo.findByIdTx(tx, p.loserId, msg.tenantId);
      if (!winner || !loser) return;
      const { attributes, sourceLineage } = mergeDomain(winner, loser);
      await repo.markMerged(tx, winner.id, loser.id, msg.tenantId, attributes, sourceLineage, loser.mergedFromIds);
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.profilesMerged,
        eventType: EVENTS.profilesMerged,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { winnerId: winner.id, loserId: loser.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "profile.merge",
        resourceType: "profile",
        resourceId: winner.id,
        details: { loserId: loser.id },
      });
    });
    if (applied) {
      await invalidateProfile(msg.tenantId, p.winnerId);
      await invalidateProfile(msg.tenantId, p.loserId);
    }
  });
}
