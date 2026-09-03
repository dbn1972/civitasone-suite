import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { caseLinks, type CaseLinkRow } from "./schema.js";
import { cases } from "../case-registry/schema.js";
import { validateLink, type CaseLink, type LinkType } from "./domain.js";
import { HttpError } from "../../shared/context.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function withTx<T>(outer: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (outer) return fn(outer);
  return db.transaction(fn);
}

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

/**
 * Read-only status lookup used for synchronous pre-checks in routes.ts (split
 * / merge). The real, race-safe enforcement still happens in the consumer
 * (persistSplit / persistMerge lock the row FOR UPDATE before asserting
 * status='open'); this is a best-effort early-reject so the common,
 * non-racing "case is already split/merged" request gets an immediate 409
 * instead of a silently-dropped async write.
 */
export async function caseStatus(tenantId: string, caseId: string): Promise<string | undefined> {
  const rows = await scopedRead((tx) =>
    tx.select({ status: cases.status }).from(cases).where(and(eq(cases.tenantId, tenantId), eq(cases.id, caseId))).limit(1),
  );
  return rows[0]?.status;
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

export type CreateLinkResult =
  | { ok: true; row: CaseLinkRow }
  | { ok: false; errors: string[] };

/**
 * PR #169 (HIGH) -- atomic, race-free link creation.
 *
 * The previous flow read existing links in one tx, ran the pure cycle check,
 * then INSERTed in a SEPARATE tx. Two concurrent requests A->B and B->A both
 * read existing=[], both passed wouldCreateCycle(), and both committed -> a
 * cycle, which the unique index (tenant,from,to,type) cannot stop (reverse
 * edge differs). Here we do everything in ONE db.transaction:
 *  1. Lock BOTH case rows FOR UPDATE, ordered by id ascending, so concurrent
 *     creations on the same pair acquire locks in the same order (no deadlock)
 *     and serialize -- the second txn blocks until the first commits.
 *  2. Re-read the tenant's links INSIDE the tx (post-lock) so the cycle check
 *     sees the link the first txn just committed.
 *  3. validateLink() -> on any failure return the guard errors (caller maps to
 *     4xx; CYCLE_DETECTED/DUPLICATE_LINK -> 409) and the tx rolls back.
 *  4. Otherwise INSERT + audit.
 */
export async function createLinkChecked(input: CreateLinkInput & { id?: string }, outer?: Tx): Promise<CreateLinkResult> {
  const id = input.id ?? randomUUID();
  const lockIds = Array.from(new Set([input.fromCaseId, input.toCaseId]));
  return withTx(outer, async (tx) => {
    await tx.select({ id: cases.id }).from(cases)
      .where(and(eq(cases.tenantId, input.tenantId), inArray(cases.id, lockIds)))
      .orderBy(asc(cases.id))
      .for("update");
    const rows = await tx.select().from(caseLinks).where(eq(caseLinks.tenantId, input.tenantId));
    const existing: CaseLink[] = rows.map((r) => ({ fromCaseId: r.fromCaseId, toCaseId: r.toCaseId, type: r.linkType as LinkType }));
    const guard = validateLink({ fromCaseId: input.fromCaseId, toCaseId: input.toCaseId, type: input.linkType, existing });
    if (!guard.allowed) return { ok: false, errors: guard.errors };
    const ins = await tx.insert(caseLinks).values({
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
    return { ok: true, row: ins[0]! };
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
export async function persistSplit(input: SplitPersistInput, outer?: Tx): Promise<string[]> {
  return withTx(outer, async (tx) => {
    // PR #169 (MEDIUM) -- lock the parent row FIRST, then assert it is still
    // 'open'. Without this a second split (or two concurrent splits) on the
    // same parent would each create a full child set -> duplicate children /
    // 200% allocation. FOR UPDATE serializes concurrent splits on this parent.
    const parent = (await tx.select().from(cases)
      .where(and(eq(cases.tenantId, input.tenantId), eq(cases.id, input.parentCaseId)))
      .limit(1).for("update"))[0];
    if (!parent) throw new HttpError(404, "NOT_FOUND", "case not found");
    if (parent.status !== "open") throw new HttpError(409, "CASE_NOT_OPEN", `case not open for split (status=${parent.status})`);
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
    // Conditional flip: WHERE status='open' so 0 rows affected == lost the race
    // (a concurrent split already moved the parent) -> conflict, rolls back.
    const flipped = await tx.update(cases).set({ status: "split", updatedAt: new Date() })
      .where(and(eq(cases.tenantId, input.tenantId), eq(cases.id, input.parentCaseId), eq(cases.status, "open")))
      .returning({ id: cases.id });
    if (flipped.length === 0) throw new HttpError(409, "CASE_NOT_OPEN", "case not open for split");
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
export async function persistMerge(input: MergePersistInput, outer?: Tx): Promise<number> {
  return withTx(outer, async (tx) => {
    // PR #169 (MEDIUM) -- lock target + all sources FOR UPDATE up front, in
    // ascending id order (deadlock-safe), then enforce that every case that
    // participates is still 'open'. Without this a merge could consume an
    // already split/merged case as source or target, or two concurrent merges
    // could both claim the same source.
    const lockIds = Array.from(new Set([input.targetId, ...input.sourceIds]));
    const locked = await tx.select().from(cases)
      .where(and(eq(cases.tenantId, input.tenantId), inArray(cases.id, lockIds)))
      .orderBy(asc(cases.id))
      .for("update");
    const byId = new Map(locked.map((r) => [r.id, r]));
    const target = byId.get(input.targetId);
    if (!target) throw new HttpError(404, "NOT_FOUND", "target case not found");
    if (target.status !== "open") throw new HttpError(409, "CASE_NOT_OPEN", `target case not open for merge (status=${target.status})`);
    let merged = 0;
    for (const sourceId of input.sourceIds) {
      if (sourceId === input.targetId) continue;
      const src = byId.get(sourceId);
      if (!src) continue; // non-existent source: skip (unchanged tolerance)
      if (src.status !== "open") throw new HttpError(409, "CASE_NOT_OPEN", `source case not open for merge (id=${sourceId}, status=${src.status})`);
      const res = await tx.update(cases)
        .set({ mergedIntoCaseId: input.targetId, status: "merged", updatedAt: new Date() })
        .where(and(eq(cases.tenantId, input.tenantId), eq(cases.id, sourceId), eq(cases.status, "open")))
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
