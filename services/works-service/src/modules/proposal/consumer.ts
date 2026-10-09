import { randomInt } from "node:crypto";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { parseMinor } from "@civitasone/schemas";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { workProposals, workSplits, workCoaMappings, workOfficeMappings } from "./schema.js";
import { generateWorkNumber, generateSplitNumber } from "./domain.js";
import { eq, and } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerProposalConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.proposalCreate, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return; // idempotent skip

      const p = msg.payload as Record<string, unknown>;
      const workNumber = generateWorkNumber(
        (p.executingDivisionId as string) ?? "GEN",
        new Date().getFullYear(),
        randomInt(1, 10000)
      );

      await tx.insert(workProposals).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workNumber,
        category: p.category as string,
        description: p.description as string,
        workTypeId: p.workTypeId as string,
        workSubTypeId: (p.workSubTypeId as string) ?? undefined,
        estimatedCostMinor: parseMinor(p.estimatedCostMinor as string | number | bigint),
        executingDivisionId: (p.executingDivisionId as string) ?? undefined,
        district: (p.district as string) ?? undefined,
        taluka: (p.taluka as string) ?? undefined,
        village: (p.village as string) ?? undefined,
        programId: (p.programId as string) ?? undefined,
        schemeId: (p.schemeId as string) ?? undefined,
        remarks: (p.remarks as string) ?? undefined,
        status: "draft",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.proposalCreated,
        eventType: EVENTS.proposalCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workNumber },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "create", resourceType: "proposal", resourceId: p.id, outcome: "success" } });
    });
    await cache.invalidateResource(msg.tenantId, "master:work_proposals");
  });

  // GAP2-WORKS-PROPOSALS-02: the PATCH edit path now routes through this
  // consumer (CQRS) instead of writing to Postgres inside the route handler.
  // It applies the patch to a draft proposal and emits the domain event plus
  // an `audit.event.record` (action=update, resourceType=proposal) in the SAME
  // transaction — the edit was previously the only unaudited proposal
  // mutation. The draft-only guard is re-asserted here (defence-in-depth; the
  // route already checked it pre-enqueue).
  queue.subscribe(COMMANDS.proposalUpdate, async (msg) => {
    const { id, patch } = msg.payload as { id: string; patch: Record<string, unknown> };
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const rows = await tx.select().from(workProposals)
        .where(and(eq(workProposals.id, id), eq(workProposals.tenantId, msg.tenantId)))
        .limit(1);
      const existing = rows[0];
      if (!existing) throw new NonRetryableError("PROPOSAL_NOT_FOUND: proposal not found for update");
      if (existing.status !== "draft") {
        throw new NonRetryableError("NOT_DRAFT: only draft proposals can be edited");
      }

      await tx.update(workProposals)
        .set({
          ...(patch as Partial<typeof workProposals.$inferInsert>),
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        })
        .where(and(eq(workProposals.id, id), eq(workProposals.tenantId, msg.tenantId)));

      await enqueue(tx, {
        topic: EVENTS.proposalUpdated,
        eventType: EVENTS.proposalUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id, fields: Object.keys(patch) },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "update", resourceType: "proposal", resourceId: id, outcome: "success", fields: Object.keys(patch) } });
    });
    await cache.invalidate(`works:${msg.tenantId}:proposal:${id}`);
  });

  queue.subscribe(COMMANDS.proposalDaoFinalize, async (msg) => {
    const { workId } = msg.payload as { workId: string };

    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      await tx.update(workProposals)
        .set({
          status: "dao_finalized",
          daoFinalizedBy: msg.actorId,
          daoFinalizedAt: new Date(),
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        })
        .where(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (await import("drizzle-orm")).eq(workProposals.id, workId) as any
        );

      await enqueue(tx, {
        topic: EVENTS.proposalDaoFinalized,
        eventType: EVENTS.proposalDaoFinalized,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { workId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "finalize", resourceType: "proposal_dao", resourceId: msg.messageId, outcome: "success" } });
    });

    // Bug fix (works-cross-entity-integrity #3, MEDIUM): getProposal() caches
    // under `works:{tenant}:proposal:{id}` (see proposal/repo.ts), keyed by
    // the proposal's id, which IS the workId. This consumer previously did
    // not invalidate that key at all, so the stale pre-finalize proposal
    // (status: "draft") stayed cached for the full TTL (default 60s — see
    // shared/infra.ts CACHE_TTL) even though the DB row was already
    // correctly updated to "dao_finalized". That caused an immediate
    // POST /v1/works/approvals/ts right after DAO-finalize to be falsely
    // blocked with 422 DAO_GATE_BLOCKED until the cache naturally expired.
    // Invalidate the correct per-id key here, same key updateProposal()
    // invalidates in proposal/repo.ts.
    await cache.invalidate(`works:${msg.tenantId}:proposal:${workId}`);
  });

  // ORPHAN FIX: proposal split — persist a child split of a parent work.
  queue.subscribe(COMMANDS.proposalSplit, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      const parentWorkId = p.parentWorkId as string;

      const existing = await tx.select().from(workSplits)
        .where(and(eq(workSplits.tenantId, msg.tenantId), eq(workSplits.parentWorkId, parentWorkId)));
      const splitNumber = generateSplitNumber(parentWorkId, existing.length + 1);

      await tx.insert(workSplits).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        parentWorkId,
        splitNumber,
        description: (p.description as string) ?? undefined,
        status: "active",
        createdBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.proposalSplit,
        eventType: EVENTS.proposalSplit,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, parentWorkId, splitNumber },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "split", resourceType: "proposal", resourceId: p.id, outcome: "success" } });
    });
  });

  // ORPHAN FIX: COA mapping — persist chart-of-account heads for a work.
  queue.subscribe(COMMANDS.proposalMapCoa, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      await tx.insert(workCoaMappings).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        majorHead: p.majorHead as string,
        subMajorHead: (p.subMajorHead as string) ?? undefined,
        minorHead: (p.minorHead as string) ?? undefined,
        subHead: (p.subHead as string) ?? undefined,
        detailHead: (p.detailHead as string) ?? undefined,
        objectHead: (p.objectHead as string) ?? undefined,
      });

      await enqueue(tx, {
        topic: EVENTS.proposalCoaMapped,
        eventType: EVENTS.proposalCoaMapped,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId, majorHead: p.majorHead },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "process", resourceType: "proposal", resourceId: p.id, outcome: "success" } });
    });
  });

  // ORPHAN FIX: office mapping — persist executing office assignment for a work.
  queue.subscribe(COMMANDS.proposalMapOffice, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      await tx.insert(workOfficeMappings).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        divisionId: p.divisionId as string,
        subDivisionId: (p.subDivisionId as string) ?? undefined,
        sectionId: (p.sectionId as string) ?? undefined,
        isNodal: (p.isNodal as boolean) ?? false,
      });

      await enqueue(tx, {
        topic: EVENTS.proposalOfficeMapped,
        eventType: EVENTS.proposalOfficeMapped,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId, divisionId: p.divisionId, isNodal: (p.isNodal as boolean) ?? false },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "process", resourceType: "proposal", resourceId: p.id, outcome: "success" } });
    });
  });
}
