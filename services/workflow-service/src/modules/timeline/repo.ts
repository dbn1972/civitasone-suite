import { and, eq, desc } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { transitionHistory } from "../history/schema.js";
import { entityComments } from "../comments/schema.js";
import { deviationRequests } from "../deviations/schema.js";
import { entityClosures } from "../closure/schema.js";
import type { TimelineEntry } from "./domain.js";

/**
 * CAP-037 — gather timeline entries for an entity across workflow tables. For
 * entityType='instance' the transition history (which is keyed by instance_id)
 * is included; comments/deviations/closure are keyed generically by
 * (entity_type, entity_id) so any entity gets them.
 */
export async function gather(tenantId: string, entityType: string, entityId: string, limit: number): Promise<TimelineEntry[]> {
  const entries: TimelineEntry[] = [];

  if (entityType === "instance") {
    const trans = await scopedRead((tx) => tx.select().from(transitionHistory)
      .where(and(eq(transitionHistory.tenantId, tenantId), eq(transitionHistory.instanceId, entityId)))
      .orderBy(desc(transitionHistory.createdAt)).limit(limit));
    for (const t of trans) {
      entries.push({
        source: "transition", id: t.id, at: t.createdAt.toISOString(), actorId: t.actorId,
        action: t.action,
        summary: `${t.action}${t.fromNode ? ` ${t.fromNode}→${t.toNode ?? "?"}` : ""}${t.decision ? ` (${t.decision})` : ""}`,
        detail: t.detail,
      });
    }
  }

  const comments = await scopedRead((tx) => tx.select().from(entityComments)
    .where(and(eq(entityComments.tenantId, tenantId), eq(entityComments.entityType, entityType), eq(entityComments.entityId, entityId)))
    .orderBy(desc(entityComments.createdAt)).limit(limit));
  for (const c of comments) {
    entries.push({
      source: "comment", id: c.id, at: c.createdAt.toISOString(), actorId: c.authorId,
      action: c.deletedAt ? "comment_deleted" : c.editedAt ? "comment_edited" : "comment_added",
      summary: c.deletedAt ? "comment removed" : `${c.visibility} note: ${c.body.slice(0, 80)}`,
      detail: { visibility: c.visibility, parentCommentId: c.parentCommentId },
    });
  }

  const deviations = await scopedRead((tx) => tx.select().from(deviationRequests)
    .where(and(eq(deviationRequests.tenantId, tenantId), eq(deviationRequests.entityType, entityType), eq(deviationRequests.entityId, entityId)))
    .orderBy(desc(deviationRequests.createdAt)).limit(limit));
  for (const d of deviations) {
    entries.push({
      source: "deviation", id: d.id, at: (d.reviewedAt ?? d.createdAt).toISOString(),
      actorId: d.reviewedBy ?? d.requestedBy,
      action: `deviation_${d.status}`,
      summary: `${d.deviationType} deviation ${d.status}`,
      detail: { deviationType: d.deviationType, status: d.status },
    });
  }

  const closures = await scopedRead((tx) => tx.select().from(entityClosures)
    .where(and(eq(entityClosures.tenantId, tenantId), eq(entityClosures.entityType, entityType), eq(entityClosures.entityId, entityId)))
    .limit(limit));
  for (const cl of closures) {
    entries.push({
      source: "closure", id: cl.id, at: cl.updatedAt.toISOString(),
      actorId: cl.archivedBy ?? cl.reopenedBy ?? cl.closedBy ?? null,
      action: `entity_${cl.status}`,
      summary: `entity ${cl.status}`,
      detail: { status: cl.status, reopenCount: cl.reopenCount },
    });
  }

  return entries;
}
