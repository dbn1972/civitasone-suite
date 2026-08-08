import type { Queue } from "@civitasone/queue";
import { parseMinor } from "@civitasone/schemas";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { workProposals, workSplits, workCoaMappings, workOfficeMappings } from "./schema.js";
import { generateWorkNumber, generateSplitNumber } from "./domain.js";
import { eq, and } from "drizzle-orm";
import { cache } from "../../shared/infra.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerProposalConsumers(q: Queue): void {
  q.subscribe(COMMANDS.proposalCreate, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return; // idempotent skip

      const p = msg.payload as Record<string, unknown>;
      const workNumber = generateWorkNumber(
        (p.executingDivisionId as string) ?? "GEN",
        new Date().getFullYear(),
        Math.floor(Math.random() * 9999) + 1
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
    await cache.invalidate(`works:${msg.tenantId}:master:work_proposals:*`);
  });

  q.subscribe(COMMANDS.proposalDaoFinalize, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const { workId } = msg.payload as { workId: string };

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
  });

  // ORPHAN FIX: proposal split — persist a child split of a parent work.
  q.subscribe(COMMANDS.proposalSplit, async (msg) => {
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
  q.subscribe(COMMANDS.proposalMapCoa, async (msg) => {
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
  q.subscribe(COMMANDS.proposalMapOffice, async (msg) => {
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
