import { randomUUID } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { caseLinks, type CaseLinkRow } from "./schema.js";
import { cases } from "../case-registry/schema.js";
import type { CaseLink, LinkType } from "./domain.js";

/** All links for a tenant as domain-shaped edges (for cycle checks). */
export async function allLinks(tenantId: string): Promise<CaseLink[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(caseLinks).where(eq(caseLinks.tenantId, tenantId)),
  );
  return rows.map((r) => ({ fromCaseId: r.fromCaseId, toCaseId: r.toCaseId, type: r.linkType as LinkType }));
}

/** Links touching a specific case (either direction). */
export async function linksForCase(tenantId: string, caseId: string): Promise<CaseLinkRow[]> {
  return scopedRead((tx) =>
    tx.select().from(caseLinks).where(
      and(eq(caseLinks.tenantId, tenantId), or(eq(caseLinks.fromCaseId, caseId), eq(caseLinks.toCaseId, caseId))),
    ),
  );
}

export async function caseExists(tenantId: string, caseId: string): Promise<boolean> {
  const rows = await scopedRead((tx) =>
    tx.select({ id: cases.id }).from(cases).where(and(eq(cases.tenantId, tenantId), eq(cases.id, caseId))).limit(1),
  );
  return rows.length > 0;
}

export interface CreateLinkInput {
  tenantId: string;
  fromCaseId: string;
  toCaseId: string;
  linkType: LinkType;
  allocation?: number | undefined;
  reason?: string | undefined;
  actorId: string;
  correlationId: string;
}

/** Insert a link + audit event inside one tenant-scoped transaction. */
export async function createLink(input: CreateLinkInput): Promise<CaseLinkRow> {
  const id = randomUUID();
  return db.transaction(async (tx) => {
    const rows = await tx.insert(caseLinks).values({
      id,
      tenantId: input.tenantId,
      fromCaseId: input.fromCaseId,
      toCaseId: input.toCaseId,
      linkType: input.linkType,
      allocation: input.allocation !== undefined ? String(input.allocation) : null,
      reason: input.reason ?? null,
      createdBy: input.actorId,
    }).returning();
    await enqueue(tx, {
      topic: "audit.event.record", eventType: "audit.event.record",
      tenantId: input.tenantId, actorId: input.actorId, correlationId: input.correlationId,
      payload: { service: "workflow", action: "link_case", resourceType: "case", resourceId: input.fromCaseId, outcome: "success", detail: { toCaseId: input.toCaseId, linkType: input.linkType } },
    });
    return rows[0]!;
  });
}

export interface SplitPersistInput {
  tenantId: string;
  parentCaseId: string;
  children: Array<{ title: string; caseType: string; allocation?: number | undefined; assigneeId?: string | undefined }>;
  actorId: string;
  correlationId: string;
}

/**
 * Persist a split: create N child cases, a split_from link (child -> parent)
 * for each carrying its allocation, mark the parent status='split', and audit.
 * Returns the created child case ids.
 */
export async function persistSplit(input: SplitPersistInput): Promise<string[]> {
  return db.transaction(async (tx) => {
    const parent = (await tx.select().from(cases).where(and(eq(cases.tenantId, input.tenantId), eq(cases.id, input.parentCaseId))).limit(1))[0];
    if (!parent) throw new Error("PARENT_NOT_FOUND");
    const childIds: string[] = [];
    for (const c of input.children) {
      const childId = randomUUID();
      childIds.push(childId);
      await tx.insert(cases).values({
        id: childId, tenantId: input.tenantId,
        caseNumber: `${parent.caseNumber}-${childId.slice(0, 4)}`,
        title: c.title, caseType: c.caseType, sourceService: parent.sourceService,
        sourceRefId: childId as unknown as string, priority: parent.priority, status: "open",
        parentCaseId: input.parentCaseId, assigneeId: c.assigneeId ?? null,
        metadata: {}, createdBy: input.actorId, version: 1,
      });
      await tx.insert(caseLinks).values({
        id: randomUUID(), tenantId: input.tenantId,
        fromCaseId: childId, toCaseId: input.parentCaseId, linkType: "split_from",
        allocation: c.allocation !== undefined ? String(c.allocation) : null,
        createdBy: input.actorId,
      });
    }
    await tx.update(cases).set({ status: "split", updatedAt: new Date() })
      .where(and(eq(cases.tenantId, input.tenantId), eq(cases.id, input.parentCaseId)));
    await enqueue(tx, {
      topic: "audit.event.record", eventType: "audit.event.record",
      tenantId: input.tenantId, actorId: input.actorId, correlationId: input.correlationId,
      payload: { service: "workflow", action: "split_case", resourceType: "case", resourceId: input.parentCaseId, outcome: "success", detail: { childCount: childIds.length } },
    });
    return childIds;
  });
}

export interface MergePersistInput {
  tenantId: string;
  sourceIds: string[];
  targetId: string;
  reason: string;
  actorId: string;
  correlationId: string;
}

/**
 * Persist a merge: mark each source merged_into target + status='merged', add a
 * merged_from link (target -> source) preserving lineage, and audit. Returns the
 * count of sources actually consolidated.
 */
export async function persistMerge(input: MergePersistInput): Promise<number> {
  return db.transaction(async (tx) => {
    const target = (await tx.select().from(cases).where(and(eq(cases.tenantId, input.tenantId), eq(cases.id, input.targetId))).limit(1))[0];
    if (!target) throw new Error("TARGET_NOT_FOUND");
    let merged = 0;
    for (const sourceId of input.sourceIds) {
      if (sourceId === input.targetId) continue;
      const res = await tx.update(cases)
        .set({ mergedIntoCaseId: input.targetId, status: "merged", updatedAt: new Date() })
        .where(and(eq(cases.tenantId, input.tenantId), eq(cases.id, sourceId)))
        .returning({ id: cases.id });
      if (res.length === 0) continue;
      merged += 1;
      await tx.insert(caseLinks).values({
        id: randomUUID(), tenantId: input.tenantId,
        fromCaseId: input.targetId, toCaseId: sourceId, linkType: "merged_from",
        reason: input.reason, createdBy: input.actorId,
      }).onConflictDoNothing();
    }
    await enqueue(tx, {
      topic: "audit.event.record", eventType: "audit.event.record",
      tenantId: input.tenantId, actorId: input.actorId, correlationId: input.correlationId,
      payload: { service: "workflow", action: "merge_cases", resourceType: "case", resourceId: input.targetId, outcome: "success", detail: { mergedCount: merged, reason: input.reason } },
    });
    return merged;
  });
}
