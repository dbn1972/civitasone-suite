import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { computeRedlines, MAX_VERSIONS_PER_CONTRACT } from "./domain.js";
import { contractVersions, redlines } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerVersionConsumers(q: Queue): void {
  q.subscribe(COMMANDS.versionCreate, async (msg) => {
    const payload = msg.payload as { id: string; contractId: string; content: string; tenantId: string };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const [countResult] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(contractVersions)
        .where(
          and(
            eq(contractVersions.contractId, payload.contractId),
            eq(contractVersions.tenantId, msg.tenantId),
          ),
        );
      if ((countResult?.count ?? 0) >= MAX_VERSIONS_PER_CONTRACT) return;

      const [latestVersion] = await tx
        .select()
        .from(contractVersions)
        .where(
          and(
            eq(contractVersions.contractId, payload.contractId),
            eq(contractVersions.tenantId, msg.tenantId),
          ),
        )
        .orderBy(desc(contractVersions.versionNumber))
        .limit(1);
      const versionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;

      await tx.insert(contractVersions).values({
        id: payload.id,
        tenantId: msg.tenantId,
        contractId: payload.contractId,
        versionNumber,
        content: payload.content,
        createdBy: msg.actorId,
      });

      if (latestVersion) {
        const changes = computeRedlines(latestVersion.content, payload.content, msg.actorId);
        if (changes.length > 0) {
          await tx.insert(redlines).values(
            changes.map((change) => ({
              id: randomUUID(),
              tenantId: msg.tenantId,
              contractId: payload.contractId,
              versionNumber,
              position: change.position,
              type: change.type,
              content: change.content,
              actor: change.actor,
              timestamp: change.timestamp,
            })),
          );
        }
      }

      await enqueue(tx, {
        topic: EVENTS.versionCreated,
        eventType: EVENTS.versionCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: payload.id, tenantId: msg.tenantId, contractId: payload.contractId, versionNumber },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "contract",
          action: "create",
          resourceType: "contract_version",
          resourceId: payload.id,
          outcome: "success",
        },
      });
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "version", `${payload.contractId}:list`));
  });
}
