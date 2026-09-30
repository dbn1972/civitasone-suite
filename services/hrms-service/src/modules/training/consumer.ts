import { hrmsServiceBookEntries } from "../service-book/schema.js";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT = "audit.event.record";

export function registerTrainingConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.trainingCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; title: string; fromDate: string; toDate: string;
      venue?: string; facilitator?: string; maxParticipants: number;
      category?: string; mode?: string; enrollmentDeadline?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertTraining(tx, {
        id: p.id, tenantId: p.tenantId, title: p.title, fromDate: p.fromDate, toDate: p.toDate,
        venue: p.venue ?? null, facilitator: p.facilitator ?? null,
        // GAP-HR-TRAINING-NEW-02: real category/mode/deadline (migration
        // 0162), null when the form left them unset -- never a guessed
        // default.
        category: p.category ?? null, mode: p.mode ?? null,
        enrollmentDeadline: p.enrollmentDeadline ?? null,
        maxParticipants: p.maxParticipants, status: "planned",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "training", p.id);
    });
    // GAP-HR-TRAINING-NEW-01: queries.listTrainingPrograms cache-first reads
    // (cache.listOrLoad, 60s default TTL, keyed by tenant+limit) previously
    // had no invalidation on write, so a newly created programme could stay
    // invisible on /hr/training for up to that TTL even after this consumer
    // committed the row -- on top of the *separate* Next.js fetch-level
    // cache the web loader also applies (see getTrainingPrograms in
    // loaders.ts). This clears every cached list for the tenant immediately
    // after commit, mirroring the same invalidateResource call every other
    // list-backed consumer in this service already makes on write (e.g.
    // ai-fraud/consumer.ts, bulk-import/consumer.ts).
    await cache.invalidateResource(p.tenantId, "training");
  });

  queue.subscribe(COMMANDS.nominationCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; trainingId: string; employeeId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertNomination(tx, {
        id: p.id, tenantId: p.tenantId, trainingId: p.trainingId, employeeId: p.employeeId,
        status: "nominated", certificateRef: null, nominatedBy: msg.actorId,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "nominate", "nomination", p.id);
    });
  });

  queue.subscribe(COMMANDS.nominationComplete, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      completedDate: string;
      result: string;
      score?: number | null;
      certificateRef?: string | null;
      trainingTitle?: string | null;
      trainingId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.completeNomination(tx, p.tenantId, p.id, msg.actorId, {
        completedDate: p.completedDate, result: p.result,
        score: p.score ?? null, certificateRef: p.certificateRef ?? null,
      });
      if (!row) return;
      await tx.insert(hrmsServiceBookEntries).values({
        tenantId: p.tenantId, employeeId: row.employeeId, entryType: "training",
        effectiveDate: p.completedDate,
        description: `Completed training "${p.trainingTitle ?? row.trainingId}" — result ${p.result}`,
        recordedBy: msg.actorId, documentRef: p.certificateRef ?? null,
      });
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType, resourceId, outcome: "success" },
  });
}
